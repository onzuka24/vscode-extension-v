import assert from 'node:assert/strict';
import test from 'node:test';
import { MARKDOWN_PREVIEW, OTHER_PREVIEW, previewCommandFor } from '../src/adapter/preview';

/**
 * `:preview` がどのコマンドを呼ぶか。
 *
 * Markdown には専用のプレビューがあるので直接開きます。それ以外は VS Code に
 * 「この形式に使えるエディタ」を出させます。
 */

test('Markdown は専用のプレビューを横に開く', () => {
  assert.equal(previewCommandFor('markdown'), MARKDOWN_PREVIEW);
});

test('Markdown 系の別名も同じ扱いにする', () => {
  // VS Code 自身の Ctrl+K V の when 句と同じ一覧です。推測ではありません。
  for (const language of ['prompt', 'instructions', 'chatagent', 'skill']) {
    assert.equal(previewCommandFor(language), MARKDOWN_PREVIEW, language);
  }
});

test('それ以外は使えるエディタを VS Code に出させる', () => {
  for (const language of ['typescript', 'json', 'plaintext', 'python', '']) {
    assert.equal(previewCommandFor(language), OTHER_PREVIEW, language);
  }
});

test('横に開くほうを使う', () => {
  // 同じ場所に開くと元の文書が見えなくなります。プレビューは並べてこそです。
  assert.equal(MARKDOWN_PREVIEW, 'markdown.showPreviewToSide');
});
