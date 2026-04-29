import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { Agent, AgentKind } from '@/types/agent';

// Mock the contexts and Toast hook the panel reaches into. Mirrors the
// module-level vi.mock pattern used by AgentContext.drafts.test.tsx; we go
// further here because AgentsPanel destructures more from useAgent and useTab.

const mockUseTab = vi.fn();
const mockUseAgent = vi.fn();
const mockUseToast = vi.fn();

vi.mock('../context/TabContext', () => ({
  useTab: () => mockUseTab(),
}));

vi.mock('../context/AgentContext', () => ({
  useAgent: () => mockUseAgent(),
}));

vi.mock('../components/ui/Toast', () => ({
  useToast: () => mockUseToast(),
}));

// PromptDialog and ContextMenu are only rendered when the user opens them;
// stubbing them keeps the tree shallow and removes Radix portal noise.
vi.mock('../components/ui/PromptDialog', () => ({
  default: () => null,
}));

vi.mock('../components/ui/ContextMenu', () => ({
  default: () => null,
}));

import AgentsPanel from '../components/ui/AgentsPanel';

interface MakeAgentOpts {
  id?: string;
  name: string;
  kind?: AgentKind;
  folder?: string;
  updatedAt: string;
  bindingsCount?: number;
}

function makeAgent({
  id,
  name,
  kind = 'chat',
  folder,
  updatedAt,
  bindingsCount = 0,
}: MakeAgentOpts): Agent {
  return {
    id: id ?? name,
    name,
    kind,
    systemPrompt: '',
    model: 'claude-sonnet-4-5',
    bindings: Array.from({ length: bindingsCount }, (_, i) => ({
      id: `${name}-b${i}`,
      source: 'workspace' as const,
      subpath: '',
      documentation: '',
    })),
    permissionMode: 'default',
    folder,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt,
  };
}

beforeEach(() => {
  mockUseTab.mockReturnValue({
    openAgentTab: vi.fn(),
    openAgentEditorTab: vi.fn(),
    renameTabsByPath: vi.fn(),
  });
  mockUseToast.mockReturnValue({ showToast: vi.fn() });
});

function setAgents(agents: Agent[], folders = { chats: [] as string[], agents: [] as string[] }) {
  mockUseAgent.mockReturnValue({
    agents,
    folders,
    createChat: vi.fn(),
    deleteAgent: vi.fn(),
    moveAgent: vi.fn(),
    createFolder: vi.fn(),
    deleteFolder: vi.fn(),
    renameFolder: vi.fn(),
    isTurnActive: () => false,
  });
}

/**
 * Find every chat/agent row by walking from the visible name to the row's
 * draggable container. The row uses `draggable` and a unique id-bearing
 * structure, but the fastest stable handle is the name span itself, which
 * is rendered inside a button whose grandparent is the row container.
 */
function findRowByName(name: string): HTMLElement {
  const span = screen.getAllByText(name, { selector: 'span' }).find(el =>
    el.className.includes('truncate')
  );
  if (!span) throw new Error(`No row span found for ${name}`);
  // span -> button -> row container
  const row = span.parentElement?.parentElement;
  if (!row) throw new Error(`No row container for ${name}`);
  return row as HTMLElement;
}

describe('AgentsPanel sorting', () => {
  it('orders chats inside a folder by updatedAt descending', () => {
    setAgents([
      makeAgent({ name: 'oldest',   kind: 'chat', folder: 'work', updatedAt: '2026-04-27T10:00:00.000Z' }),
      makeAgent({ name: 'newest',   kind: 'chat', folder: 'work', updatedAt: '2026-04-29T10:00:00.000Z' }),
      makeAgent({ name: 'middle',   kind: 'chat', folder: 'work', updatedAt: '2026-04-28T10:00:00.000Z' }),
    ]);

    render(<AgentsPanel />);
    const order = ['newest', 'middle', 'oldest'].map(findRowByName);
    // Each row sits below the previous in document order — assert via DOCUMENT_POSITION_FOLLOWING.
    expect(order[0].compareDocumentPosition(order[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(order[1].compareDocumentPosition(order[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('orders agents inside a folder independently of chats', () => {
    setAgents([
      makeAgent({ name: 'chat-old',    kind: 'chat',  folder: 'work', updatedAt: '2026-04-20T10:00:00.000Z' }),
      makeAgent({ name: 'chat-new',    kind: 'chat',  folder: 'work', updatedAt: '2026-04-29T10:00:00.000Z' }),
      makeAgent({ name: 'agent-old',   kind: 'agent', folder: 'work', updatedAt: '2026-04-21T10:00:00.000Z' }),
      makeAgent({ name: 'agent-new',   kind: 'agent', folder: 'work', updatedAt: '2026-04-28T10:00:00.000Z' }),
    ]);

    render(<AgentsPanel />);
    const chatNew = findRowByName('chat-new');
    const chatOld = findRowByName('chat-old');
    const agentNew = findRowByName('agent-new');
    const agentOld = findRowByName('agent-old');
    expect(chatNew.compareDocumentPosition(chatOld) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(agentNew.compareDocumentPosition(agentOld) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('orders the uncategorized list by recency', () => {
    setAgents([
      makeAgent({ name: 'c-old', kind: 'chat', updatedAt: '2026-04-10T10:00:00.000Z' }),
      makeAgent({ name: 'c-new', kind: 'chat', updatedAt: '2026-04-29T10:00:00.000Z' }),
    ]);

    render(<AgentsPanel />);
    const newRow = findRowByName('c-new');
    const oldRow = findRowByName('c-old');
    expect(newRow.compareDocumentPosition(oldRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps folders alphabetical regardless of contained item recency', () => {
    setAgents([
      // folder "alpha" contains the OLDEST item; folder "zulu" contains the NEWEST.
      makeAgent({ name: 'alpha-item', kind: 'chat', folder: 'alpha', updatedAt: '2026-01-01T00:00:00.000Z' }),
      makeAgent({ name: 'zulu-item',  kind: 'chat', folder: 'zulu',  updatedAt: '2026-04-29T00:00:00.000Z' }),
    ]);

    render(<AgentsPanel />);
    const alphaItem = findRowByName('alpha-item');
    const zuluItem = findRowByName('zulu-item');
    // Folder "alpha" should still render before "zulu" — alpha-item appears
    // first in the DOM despite zulu-item being the more recent row.
    expect(alphaItem.compareDocumentPosition(zuluItem) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('breaks ties on identical updatedAt by name ascending', () => {
    const ts = '2026-04-29T12:00:00.000Z';
    setAgents([
      makeAgent({ name: 'beta',  kind: 'chat', updatedAt: ts }),
      makeAgent({ name: 'alpha', kind: 'chat', updatedAt: ts }),
    ]);

    render(<AgentsPanel />);
    const alphaRow = findRowByName('alpha');
    const betaRow = findRowByName('beta');
    expect(alphaRow.compareDocumentPosition(betaRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('AgentsPanel row metadata', () => {
  it('renders a <time> element with the local-formatted date and the full ISO in dateTime', () => {
    const iso = '2026-04-29T10:14:33.987Z';
    setAgents([makeAgent({ name: 'sample', kind: 'chat', updatedAt: iso })]);

    render(<AgentsPanel />);
    const row = findRowByName('sample');
    const time = row.querySelector('time');
    expect(time).toBeTruthy();
    expect(time?.getAttribute('datetime')).toBe(iso);
    // Use the same formatter as production so the test stays correct under
    // whatever timezone the test environment uses.
    const expectedDate = new Date(iso).toLocaleDateString('sv-SE');
    expect(time?.textContent).toBe(expectedDate);
  });

  it('shifts the displayed date to the user local timezone, not UTC', () => {
    // 2026-04-30 03:00 UTC is still 2026-04-29 in any negative-offset zone.
    // The exact offset of the test environment varies; we assert the panel
    // matches the LOCAL-zone calculation, never the UTC slice.
    const iso = '2026-04-30T03:00:00.000Z';
    setAgents([makeAgent({ name: 'tz', kind: 'chat', updatedAt: iso })]);

    render(<AgentsPanel />);
    const row = findRowByName('tz');
    const expected = new Date(iso).toLocaleDateString('sv-SE');
    const utcSlice = iso.slice(0, 10); // What the WRONG implementation would emit.
    const time = row.querySelector('time');
    expect(time?.textContent).toBe(expected);
    // If `expected !== utcSlice` in the running env, this asserts we did NOT
    // accidentally emit the UTC date. If they happen to coincide (UTC test
    // env), the test still passes — we just lose the discriminating power.
    if (expected !== utcSlice) {
      expect(time?.textContent).not.toBe(utcSlice);
    }
  });

  it('renders a binding-count chip with aria-label when bindings exist', () => {
    setAgents([
      makeAgent({ name: 'one',  kind: 'chat', updatedAt: '2026-04-29T00:00:00.000Z', bindingsCount: 1 }),
      makeAgent({ name: 'many', kind: 'chat', updatedAt: '2026-04-28T00:00:00.000Z', bindingsCount: 3 }),
    ]);

    render(<AgentsPanel />);
    const oneRow = findRowByName('one');
    const manyRow = findRowByName('many');

    const oneChip = within(oneRow).getByLabelText('1 context binding');
    expect(oneChip.textContent).toBe('1');

    const manyChip = within(manyRow).getByLabelText('3 context bindings');
    expect(manyChip.textContent).toBe('3');
  });

  it('does not render a binding-count chip when bindings is empty', () => {
    setAgents([makeAgent({ name: 'lonely', kind: 'chat', updatedAt: '2026-04-29T00:00:00.000Z', bindingsCount: 0 })]);

    render(<AgentsPanel />);
    const row = findRowByName('lonely');
    expect(within(row).queryByLabelText(/context binding/i)).toBeNull();
  });

  it('preserves DOM order: name, running dot (when active), chip (when bindings), time', () => {
    setAgents([
      makeAgent({ name: 'busy', kind: 'chat', updatedAt: '2026-04-29T00:00:00.000Z', bindingsCount: 2 }),
    ]);
    // Override isTurnActive to make this row "running".
    mockUseAgent.mockReturnValue({
      ...mockUseAgent(),
      isTurnActive: (id: string) => id === 'busy',
    });

    render(<AgentsPanel />);
    const row = findRowByName('busy');
    const button = row.querySelector('button');
    expect(button).toBeTruthy();

    // Children of the row's main button include: icon, name span, running
    // dot, chip, <time>. The order is what the plan specifies.
    const children = Array.from(button!.children);
    const nameIdx = children.findIndex((c) => c.textContent === 'busy' && c.tagName === 'SPAN');
    const dotIdx = children.findIndex((c) => c.tagName === 'SPAN' && c.className.includes('animate-pulse'));
    const chipIdx = children.findIndex((c) => c.getAttribute('aria-label')?.includes('context binding'));
    const timeIdx = children.findIndex((c) => c.tagName === 'TIME');

    expect(nameIdx).toBeGreaterThanOrEqual(0);
    expect(dotIdx).toBeGreaterThan(nameIdx);
    expect(chipIdx).toBeGreaterThan(dotIdx);
    expect(timeIdx).toBeGreaterThan(chipIdx);
  });
});
