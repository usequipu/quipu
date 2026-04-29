import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react';

// Mock the AgentChat module's context dependencies. ChatView itself isn't
// mounted here — we only render the AskUserQuestion-related components — but
// importing ChatView still pulls these context modules into the graph, so
// they need to resolve to something benign.
vi.mock('@/context/TabContext', () => ({
  useTab: () => ({
    openFile: vi.fn(),
    openAgentEditorTab: vi.fn(),
    renameTabsByPath: vi.fn(),
  }),
}));
vi.mock('@/context/AgentContext', () => ({
  useAgent: () => ({}),
}));
vi.mock('@/context/FileSystemContext', () => ({
  useFileSystem: () => ({ workspacePath: null }),
}));
vi.mock('@/context/RepoContext', () => ({
  useRepo: () => ({ repos: [] }),
}));
// Avoid markdown / slash command imports doing work during ChatView module
// load. We don't render the full ChatView in this test file.
vi.mock('@/extensions/agent-chat/ThinkingIndicator', () => ({
  default: () => null,
}));
vi.mock('@/extensions/agent-chat/MessageMarkdown', () => ({
  default: () => null,
}));
vi.mock('@/extensions/agent-chat/SlashPopover', () => ({
  default: () => null,
  filterSlashCommands: () => [],
}));
vi.mock('@/extensions/agent-chat/useClaudeCommands', () => ({
  useClaudeCommands: () => [],
}));
vi.mock('@/extensions/agent-chat/ModelPicker', () => ({
  default: () => null,
}));

// ChatView's module references useTab from a relative path; mirror the @-alias
// mocks above for the relative paths the file uses.
vi.mock('../context/TabContext', () => ({
  useTab: () => ({
    openFile: vi.fn(),
    openAgentEditorTab: vi.fn(),
    renameTabsByPath: vi.fn(),
  }),
}));
vi.mock('../context/AgentContext', () => ({
  useAgent: () => ({}),
}));
vi.mock('../context/FileSystemContext', () => ({
  useFileSystem: () => ({ workspacePath: null }),
}));
vi.mock('../context/RepoContext', () => ({
  useRepo: () => ({ repos: [] }),
}));

import { AskQuestionBody, PermissionRequestItem, parseAskQuestions } from '@/extensions/agent-chat/ChatView';
import type { AgentPermissionRequest } from '@/types/agent';

describe('parseAskQuestions', () => {
  it('returns null for missing input', () => {
    expect(parseAskQuestions(undefined)).toBeNull();
    expect(parseAskQuestions({})).toBeNull();
  });

  it('returns null when questions field is not an array', () => {
    expect(parseAskQuestions({ questions: 'oops' as unknown as never })).toBeNull();
    expect(parseAskQuestions({ questions: { 0: 'malformed' } as unknown as never })).toBeNull();
  });

  it('parses well-formed questions and skips bad entries', () => {
    const parsed = parseAskQuestions({
      questions: [
        { question: 'Q1', options: [{ label: 'A' }, { label: 'B', description: 'desc' }] },
        { not_a_question: true },
        { question: 'Q2', header: 'h', options: [{ label: 'X' }] },
      ],
    });
    expect(parsed).toEqual([
      { question: 'Q1', header: undefined, options: [{ label: 'A', description: undefined }, { label: 'B', description: 'desc' }], multiSelect: undefined },
      { question: 'Q2', header: 'h', options: [{ label: 'X', description: undefined }], multiSelect: undefined },
    ]);
  });

  it('omits malformed options inside otherwise-valid questions', () => {
    const parsed = parseAskQuestions({
      questions: [
        { question: 'Q', options: [{ label: 'ok' }, { description: 'no label' }, 'string-option'] },
      ],
    });
    expect(parsed?.[0].options).toEqual([{ label: 'ok', description: undefined }]);
  });
});

describe('AskQuestionBody', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders each option as a button (no <li> bullet list)', () => {
    const onAnswer = vi.fn();
    render(
      <AskQuestionBody
        questions={[{
          question: 'Pick a flavor',
          options: [{ label: 'Vanilla' }, { label: 'Chocolate' }],
        }]}
        disabled={false}
        onAnswer={onAnswer}
      />,
    );
    const vanilla = screen.getByRole('button', { name: 'Vanilla' });
    const chocolate = screen.getByRole('button', { name: 'Chocolate' });
    expect(vanilla.tagName).toBe('BUTTON');
    expect(chocolate.tagName).toBe('BUTTON');
    // No <li> bullet list inside the body.
    expect(document.querySelector('ul')).toBeNull();
  });

  it('single-question: clicking an option auto-submits with one answer', () => {
    const onAnswer = vi.fn();
    render(
      <AskQuestionBody
        questions={[{
          question: 'Yes or no?',
          options: [{ label: 'Yes' }, { label: 'No' }],
        }]}
        disabled={false}
        onAnswer={onAnswer}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith([
      { question: 'Yes or no?', answer: 'Yes' },
    ]);
  });

  it('multi-question: requires every question answered before "Send answers" enables', () => {
    const onAnswer = vi.fn();
    render(
      <AskQuestionBody
        questions={[
          { question: 'Q1', options: [{ label: 'A' }, { label: 'B' }] },
          { question: 'Q2', options: [{ label: 'X' }, { label: 'Y' }] },
        ]}
        disabled={false}
        onAnswer={onAnswer}
      />,
    );
    const send = screen.getByRole('button', { name: 'Send answers' });
    expect(send).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'A' }));
    // Still disabled — Q2 not answered yet.
    expect(send).toBeDisabled();
    // No premature submit.
    expect(onAnswer).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'X' }));
    expect(send).toBeEnabled();

    // Swap selection in Q1 from A → B.
    fireEvent.click(screen.getByRole('button', { name: 'B' }));
    expect(send).toBeEnabled();

    fireEvent.click(send);
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith([
      { question: 'Q1', answer: 'B' },
      { question: 'Q2', answer: 'X' },
    ]);
  });

  it('disabled=true: option clicks do not fire onAnswer', () => {
    const onAnswer = vi.fn();
    render(
      <AskQuestionBody
        questions={[{ question: 'Q', options: [{ label: 'A' }] }]}
        disabled
        onAnswer={onAnswer}
      />,
    );
    const btn = screen.getByRole('button', { name: 'A' });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onAnswer).not.toHaveBeenCalled();
  });
});

describe('PermissionRequestItem — AskUserQuestion flow', () => {
  function buildAskRequest(input: AgentPermissionRequest['input']): AgentPermissionRequest {
    return {
      toolUseId: 'tu-1',
      toolName: 'AskUserQuestion',
      action: 'AskUserQuestion',
      input,
      status: 'pending',
    };
  }

  it('clicking an option button calls onRespondPermission with deny + JSON answers', () => {
    const onRespond = vi.fn();
    render(
      <ul>
        <PermissionRequestItem
          req={buildAskRequest({
            questions: [
              { question: 'Pick a color', options: [{ label: 'Red' }, { label: 'Blue' }] },
            ],
          })}
          isFirst
          onRespondPermission={onRespond}
          agent={undefined}
          workspacePath={null}
          repos={[]}
        />
      </ul>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Red' }));
    expect(onRespond).toHaveBeenCalledTimes(1);
    expect(onRespond).toHaveBeenCalledWith('deny', {
      message: JSON.stringify({ answers: [{ question: 'Pick a color', answer: 'Red' }] }),
    });
  });

  it('"Let agent answer" still fires allow with no opts', () => {
    const onRespond = vi.fn();
    render(
      <ul>
        <PermissionRequestItem
          req={buildAskRequest({
            questions: [{ question: 'q', options: [{ label: 'A' }] }],
          })}
          isFirst
          onRespondPermission={onRespond}
          agent={undefined}
          workspacePath={null}
          repos={[]}
        />
      </ul>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Let agent answer/i }));
    expect(onRespond).toHaveBeenCalledTimes(1);
    expect(onRespond).toHaveBeenCalledWith('allow');
  });

  it('"Cancel" still fires deny with no opts (default denial reason)', () => {
    const onRespond = vi.fn();
    render(
      <ul>
        <PermissionRequestItem
          req={buildAskRequest({
            questions: [{ question: 'q', options: [{ label: 'A' }] }],
          })}
          isFirst
          onRespondPermission={onRespond}
          agent={undefined}
          workspacePath={null}
          repos={[]}
        />
      </ul>,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
    expect(onRespond).toHaveBeenCalledTimes(1);
    expect(onRespond).toHaveBeenCalledWith('deny');
  });

  it('malformed input (no questions array) falls back to "Let agent answer" / "Cancel" buttons', () => {
    const onRespond = vi.fn();
    render(
      <ul>
        <PermissionRequestItem
          req={buildAskRequest({ not_questions: 1 } as unknown as AgentPermissionRequest['input'])}
          isFirst
          onRespondPermission={onRespond}
          agent={undefined}
          workspacePath={null}
          repos={[]}
        />
      </ul>,
    );
    // Doesn't crash; renders the fallback action buttons.
    expect(screen.getByRole('button', { name: /Let agent answer/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Cancel$/i })).toBeInTheDocument();
  });

  it('question with zero options renders no option buttons but still shows fallback actions', () => {
    const onRespond = vi.fn();
    render(
      <ul>
        <PermissionRequestItem
          req={buildAskRequest({
            questions: [{ question: 'free-form', options: [] }],
          })}
          isFirst
          onRespondPermission={onRespond}
          agent={undefined}
          workspacePath={null}
          repos={[]}
        />
      </ul>,
    );
    // Question text is shown.
    expect(screen.getByText('free-form')).toBeInTheDocument();
    // No "Send answers" button (only single-question with options shows it).
    expect(screen.queryByRole('button', { name: 'Send answers' })).not.toBeInTheDocument();
    // Fallbacks still rendered.
    expect(screen.getByRole('button', { name: /Let agent answer/i })).toBeInTheDocument();
  });

  it('after submitting, header shows "answered" and option buttons disable', () => {
    const onRespond = vi.fn();
    const { rerender } = render(
      <ul>
        <PermissionRequestItem
          req={buildAskRequest({
            questions: [{ question: 'Q', options: [{ label: 'A' }] }],
          })}
          isFirst
          onRespondPermission={onRespond}
          agent={undefined}
          workspacePath={null}
          repos={[]}
        />
      </ul>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'A' }));
    // Parent flips status to 'denied' once respondToPermission completes — simulate it.
    rerender(
      <ul>
        <PermissionRequestItem
          req={{ ...buildAskRequest({
            questions: [{ question: 'Q', options: [{ label: 'A' }] }],
          }), status: 'denied' }}
          isFirst
          onRespondPermission={onRespond}
          agent={undefined}
          workspacePath={null}
          repos={[]}
        />
      </ul>,
    );
    // Header now shows "answered" instead of "denied".
    expect(screen.getByText('answered')).toBeInTheDocument();
    expect(screen.queryByText('denied')).not.toBeInTheDocument();
    // Option button is disabled.
    expect(screen.getByRole('button', { name: 'A' })).toBeDisabled();
    // Pending action row hidden (no Cancel button anymore).
    expect(screen.queryByRole('button', { name: /^Cancel$/i })).not.toBeInTheDocument();
  });
});
