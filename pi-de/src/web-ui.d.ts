/* TypeScript JSX declarations for pi-web-ui custom elements */
import "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "agent-interface": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
      "chat-panel": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
    }
  }
}
