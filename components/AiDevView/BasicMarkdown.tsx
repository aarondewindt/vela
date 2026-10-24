import { Fragment } from 'react';
import { Code, Text } from '@mantine/core';
import classes from './AiDevView.module.css';

// A deliberately small text-only Markdown subset. React escapes all model output;
// HTML, images and executable links are never interpreted.
export function BasicMarkdown({ text }: { text: string }) {
  const inline = (line: string) =>
    line
      .split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
      .map((part, index) =>
        part.startsWith('**') && part.endsWith('**') ? (
          <strong key={index}>{part.slice(2, -2)}</strong>
        ) : part.startsWith('`') && part.endsWith('`') ? (
          <Code key={index}>{part.slice(1, -1)}</Code>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        )
      );
  return (
    <div className={classes.messageText}>
      {text.split('\n').map((line, index) => {
        const heading = /^(#{1,6})\s+(.*)$/.exec(line);
        if (heading) {
          return (
            <Text key={index} fw={700} mt="xs">
              {inline(heading[2])}
            </Text>
          );
        }
        return <div key={index}>{line ? inline(line.replace(/^[-*] /, '• ')) : '\u00a0'}</div>;
      })}
    </div>
  );
}
