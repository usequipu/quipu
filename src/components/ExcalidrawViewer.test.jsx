import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
// Excalidraw is aliased to a mock in vitest.config.js (resolve.alias)
// so ExcalidrawViewer.jsx will import our lightweight mock instead of the real package
import ExcalidrawViewer from './ExcalidrawViewer.jsx';

describe('ExcalidrawViewer', () => {
  beforeEach(() => {
    window.__excalidrawProps = null;
  });

  it('renders Excalidraw component', () => {
    const { getByTestId } = render(
      <ExcalidrawViewer content='{"elements":[],"appState":{}}' filePath="/test.excalidraw" />
    );
    expect(getByTestId('excalidraw-mock')).toBeInTheDocument();
  });

  it('uses dark theme', () => {
    render(
      <ExcalidrawViewer content='{"elements":[],"appState":{}}' filePath="/test2.excalidraw" />
    );
    expect(window.__excalidrawProps.theme).toBe('dark');
  });

  it('parses valid JSON content into initialData', () => {
    const content = JSON.stringify({
      elements: [{ type: 'rectangle', x: 0, y: 0 }],
      appState: { viewBackgroundColor: '#fff' },
      files: { 'file1': { data: 'base64' } },
    });

    render(
      <ExcalidrawViewer content={content} filePath="/test3.excalidraw" />
    );

    const { initialData } = window.__excalidrawProps;
    expect(initialData.elements).toHaveLength(1);
    expect(initialData.elements[0].type).toBe('rectangle');
    expect(initialData.appState.viewBackgroundColor).toBe('#fff');
  });

  it('handles invalid JSON gracefully', () => {
    render(
      <ExcalidrawViewer content="not valid json" filePath="/test4.excalidraw" />
    );

    const { initialData } = window.__excalidrawProps;
    expect(initialData.elements).toEqual([]);
  });

  it('disables saveAsImage and export in UIOptions', () => {
    render(
      <ExcalidrawViewer content='{"elements":[]}' filePath="/test5.excalidraw" />
    );

    const { UIOptions } = window.__excalidrawProps;
    expect(UIOptions.canvasActions.saveAsImage).toBe(false);
    expect(UIOptions.canvasActions.export).toBe(false);
  });

  it('skips first 2 onChange calls (initialization)', () => {
    const onContentChange = vi.fn();

    render(
      <ExcalidrawViewer
        content='{"elements":[],"appState":{}}'
        filePath="/test6.excalidraw"
        onContentChange={onContentChange}
      />
    );

    const { onChange } = window.__excalidrawProps;

    // First 2 calls should be skipped
    onChange([], {}, {});
    onChange([], {}, {});

    expect(onContentChange).not.toHaveBeenCalled();
  });
});
