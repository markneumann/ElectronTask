type WidgetPingResult = {
  ok: boolean;
  message: string;
};

interface Window {
  widget: {
    ping: () => Promise<WidgetPingResult>;
  };
}
