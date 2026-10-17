import { blockNoteText, taskEmbeddingDocument } from './text';
const task = {
  id: 'a',
  title: 'Book dentist',
  brief: 'Annual checkup',
  firstStep: null,
  tags: ['health'],
  content: null,
  updatedAt: new Date(),
};
it('extracts readable text from nested blocks, links and tables without metadata', () => {
  expect(
    blockNoteText([
      {
        id: 'private',
        props: { url: 'secret' },
        content: [
          { text: 'Book ' },
          { type: 'link', href: 'private-url', content: [{ text: 'a visit' }] },
        ],
        children: [{ content: [{ text: 'Bring ID' }] }],
      },
      { content: { rows: [{ cells: [{ content: [{ text: 'When' }] }, [{ text: 'Tomorrow' }]] }] } },
    ])
  ).toBe('Book a visit\nBring ID\nWhen\tTomorrow');
});
it('ignores editor formatting and nonsemantic task metadata in hashes', () => {
  const first = taskEmbeddingDocument({
    ...task,
    content: [{ content: [{ text: 'Hello', styles: { bold: true } }] }],
  });
  const second = taskEmbeddingDocument({
    ...task,
    updatedAt: new Date(0),
    content: [{ content: [{ text: 'Hel' }, { text: 'lo' }] }],
  });
  expect(first.sourceHash).toBe(second.sourceHash);
  expect(taskEmbeddingDocument({ ...task, title: 'Changed title' }).sourceHash).not.toBe(
    taskEmbeddingDocument(task).sourceHash
  );
});
