/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
'use strict';

import * as vscode from 'vscode';
import * as fs from 'fs'

const request = require('request')

export function activate(context: vscode.ExtensionContext) {

	let previewUri = vscode.Uri.parse('css-preview://authority/css-preview');
	
	let timeout = null;
	const d = vscode.languages.createDiagnosticCollection();

	function get_error_position(erromessage: string) {
		const positions = erromessage.match(/[\d,]+/g);
		if (positions.length == 0)
			throw new Error('invalid error response. ' + erromessage);
		const first = positions[0];

		// pattern => got unexpected token: 7,10-7,10: Op '{'
		if (first.includes(','))
			return first.match(/[\d]+/g);;

		// pattern => Got unexpected token at line 5 column 14
		return positions;
	}
	class TextDocumentContentProvider implements vscode.TextDocumentContentProvider {
		private _onDidChange = new vscode.EventEmitter<vscode.Uri>();

		public provideTextDocumentContent(uri: vscode.Uri): string {
			return this.createCssSnippet();
		}

		get onDidChange(): vscode.Event<vscode.Uri> {
			return this._onDidChange.event;
		}

		public update(uri: vscode.Uri) {
			clearTimeout(timeout);
			timeout = setTimeout(() => {
				const editor = vscode.window.activeTextEditor;
				const doc = editor.document;
	
				console.log("change");
				const type:string =getType(doc.getText());
				const options = {
					uri: 'http://localhost:8000/api/v1/' + type,
					headers: {
						'Content-Type': 'application/json'
					},
					json: {
						'source': doc.getText()
					}
				}
				request.post(options, (error, response, body) => {
					d.clear();
					d.set(doc.uri, []);
					if (response.statusCode === 200) {
						fs.writeFileSync('/tmp/sample/test.svg', body.image)
					} else {
						const erromessage: string = body.error;
						console.log(body.error);	
						const position = get_error_position(body.error);
						const line = position[0];
						const column = position[1];
	
						const startPos = doc.lineAt(Number(line) - 1).range;
						// let endPos = doc.positionAt(Number(line) + 1);
						// const range = new vscode.Range(startPos, endPos);
						const n: number = doc.offsetAt(startPos.start) + Number(column) - 2;
						// const p:vscode.Position = doc.positionAt(n);
						const ran = new vscode.Range(doc.positionAt(n), doc.positionAt(n + 1))
						
						const diag = new vscode.Diagnostic(ran, body.error, vscode.DiagnosticSeverity.Error);
						d.set(doc.uri, [diag]);
	
					}
				});
			}, 500);	
		}

		private createCssSnippet() {
			let editor = vscode.window.activeTextEditor;
			if (!(editor.document.languageId === 'css')) {
				return this.errorSnippet("Active editor doesn't show a CSS document - no properties to preview.")
			}
			return this.extractSnippet();
		}

		private extractSnippet(): string {
			let editor = vscode.window.activeTextEditor;
			let text = editor.document.getText();
			let selStart = editor.document.offsetAt(editor.selection.anchor);
			let propStart = text.lastIndexOf('{', selStart);
			let propEnd = text.indexOf('}', selStart);

			if (propStart === -1 || propEnd === -1) {
				return this.errorSnippet("Cannot determine the rule's properties.");
			} else {
				return this.snippet(editor.document, propStart, propEnd);
			}
		}

		private errorSnippet(error: string): string {
			return `
				<body>
					${error}
				</body>`;
		}

		private snippet(document: vscode.TextDocument, propStart: number, propEnd: number): string {
			const properties = document.getText().slice(propStart + 1, propEnd);
			return `<style>
					#el {
						${properties}
					}
				</style>
				<body>
					<div>Preview of the <a href="${encodeURI('command:extension.revealCssRule?' + JSON.stringify([document.uri, propStart, propEnd]))}">CSS properties</a></div>
					<hr>
					<div id="el">Lorem ipsum dolor sit amet, mi et mauris nec ac luctus lorem, proin leo nulla integer metus vestibulum lobortis, eget</div>
				</body>`;
		}
	}

	let provider = new TextDocumentContentProvider();
	let registration = vscode.workspace.registerTextDocumentContentProvider('css-preview', provider);

	vscode.workspace.onDidChangeTextDocument((e: vscode.TextDocumentChangeEvent) => {
		if (e.document === vscode.window.activeTextEditor.document) {
			provider.update(previewUri);
		}
	});

	vscode.window.onDidChangeTextEditorSelection((e: vscode.TextEditorSelectionChangeEvent) => {
		if (e.textEditor === vscode.window.activeTextEditor) {
			provider.update(previewUri);
		}
	})

	let disposable = vscode.commands.registerCommand('extension.showBlockDiagPreview', () => {
		return vscode.commands.executeCommand('vscode.previewHtml', "file:///tmp/sample/test.svg", vscode.ViewColumn.Two, 'CSS Property Preview').then((success) => {
		}, (reason) => {
			vscode.window.showErrorMessage(reason);
		});
	});

	let highlight = vscode.window.createTextEditorDecorationType({ backgroundColor: 'rgba(200,200,200,.35)' });

	vscode.commands.registerCommand('extension.revealCssRule', (uri: vscode.Uri, propStart: number, propEnd: number) => {

		for (let editor of vscode.window.visibleTextEditors) {
			if (editor.document.uri.toString() === uri.toString()) {
				let start = editor.document.positionAt(propStart);
				let end = editor.document.positionAt(propEnd + 1);

				editor.setDecorations(highlight, [new vscode.Range(start, end)]);
				setTimeout(() => editor.setDecorations(highlight, []), 1500);
			}
		}
	});

	function getType(code: string):string  {
		const reg = RegExp("(.+)\s*{", "g").exec(code)
		if (reg.length > 1)
			return reg[1];
		return null;
	}

	context.subscriptions.push(disposable, registration);
}
