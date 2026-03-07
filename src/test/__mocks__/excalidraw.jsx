const noop = () => {};

export const Excalidraw = ({ initialData, onChange, theme, excalidrawAPI, UIOptions }) => {
  window.__excalidrawProps = { initialData, onChange, theme, excalidrawAPI, UIOptions };
  // Don't call excalidrawAPI during render — it triggers setState in parent causing infinite loop
  return <div data-testid="excalidraw-mock" data-theme={theme}>Excalidraw</div>;
};

export const serializeAsJSON = (elements, appState, files) =>
  JSON.stringify({ elements, appState, files });
