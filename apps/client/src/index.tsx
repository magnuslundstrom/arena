import { render } from "solid-js/web";

import "./styles.css";

function App() {
  return (
    <main>
      <p class="eyebrow">ARENA PROTOCOL ONLINE</p>
      <h1>Enter the arena.</h1>
      <p class="lede">
        A competitive 2v2 combat prototype. The server owns game truth; this
        client renders it.
      </p>
      <button type="button" disabled>
        Matchmaking coming soon
      </button>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

render(() => <App />, root);
