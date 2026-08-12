import * as vscode from 'vscode';
import { TextBuffer } from '../core/buffer';
import { Position, Range, pos } from '../core/types';

/**
 * Presents a `TextDocument` through the core's read-only buffer interface.
 * Reading lines on demand keeps every keystroke O(1) instead of copying the
 * whole document into an array.
 */
export class DocumentBuffer implements TextBuffer {
  public constructor(private readonly document: vscode.TextDocument) {}

  public get lineCount(): number {
    return this.document.lineCount;
  }

  public lineAt(line: number): string {
    return this.document.lineAt(line).text;
  }

  public get eol(): string {
    return this.document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
  }
}

export function toVsPosition(position: Position): vscode.Position {
  return new vscode.Position(position.line, position.character);
}

export function toVsRange(range: Range): vscode.Range {
  return new vscode.Range(toVsPosition(range.start), toVsPosition(range.end));
}

export function fromVsPosition(position: vscode.Position): Position {
  return pos(position.line, position.character);
}
