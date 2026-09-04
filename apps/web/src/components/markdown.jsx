import { memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Prism from "prismjs";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-docker";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-python";
import "prismjs/components/prism-json";

/**
 * Markdown rendering for answers.
 *
 * Code blocks get the most attention here on purpose. This is a product for
 * a coding school: answers are full of Dockerfiles, YAML, shell commands and
 * kubectl invocations, and those are the parts a student will copy and run.
 *
 * Highlighting covers exactly the five languages the course uses. Prism's
 * core plus those grammars is about 12KB; anything else would be paying for
 * languages nobody here writes.
 *
 * Inline citations -- the model is asked to write "(Session 18)" -- are
 * turned into markers that jump to the matching source below the answer.
 * The rewrite skips fenced code, where the same text would be content.
 */

const ALIASES = {
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  dockerfile: "docker",
  yml: "yaml",
  py: "python",
};

function escapeHtml(s) {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
}

function highlight(text, language) {
  const key = ALIASES[language] || language;
  const grammar = key && Prism.languages[key];
  return grammar ? Prism.highlight(text, grammar, key) : escapeHtml(text);
}

const CITATION = /\(Session (\d+)\)/g;

function linkCitations(markdown) {
  return markdown
    .split(/(```[\s\S]*?```)/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(CITATION, (_, n) => `[Session ${n}](#session-${n})`)))
    .join("");
}

function jumpToSource(event) {
  const n = event.currentTarget.dataset.cite;
  const turn = event.currentTarget.closest(".turn");
  const source = turn?.querySelector(`.source[data-session="${n}"]`);
  if (!source) return;

  const row = source.querySelector(".source-row");
  if (row && row.getAttribute("aria-expanded") !== "true") row.click();

  source.classList.add("flash");
  setTimeout(() => source.classList.remove("flash"), 1400);
  source.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function CodeBlock({ children, className }) {
  const [copied, setCopied] = useState(false);
  const language = /language-(\w+)/.exec(className || "")?.[1];
  const text = String(children).replace(/\n$/, "");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be refused on an insecure origin or by the user.
      // Failing quietly is right -- the code is on screen and selectable.
    }
  }

  return (
    <div className="code">
      <div className="code-head">
        <span className="lang">{language || "text"}</span>
        <button type="button" className="copy" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code dangerouslySetInnerHTML={{ __html: highlight(text, language) }} />
      </pre>
    </div>
  );
}

const components = {
  code({ inline, className, children, ...props }) {
    // react-markdown 9 no longer passes `inline`; a fenced block either has a
    // language class or spans lines, and inline code never does either.
    const fenced = !inline && (/language-/.test(className || "") || String(children).includes("\n"));
    if (fenced) return <CodeBlock className={className}>{children}</CodeBlock>;
    return (
      <code className="inline" {...props}>
        {children}
      </code>
    );
  },
  // CodeBlock renders its own <pre>; without this the two would nest.
  pre: ({ children }) => <>{children}</>,
  a({ children, href, ...props }) {
    if (href && href.startsWith("#session-")) {
      const n = href.slice("#session-".length);
      return (
        <button
          type="button"
          className="cite"
          data-cite={n}
          onClick={jumpToSource}
          title={`Show the passage from Session ${n}`}
        >
          {children}
        </button>
      );
    }
    return (
      <a href={href} target="_blank" rel="noreferrer noopener" {...props}>
        {children}
      </a>
    );
  },
  // Wide tables scroll inside themselves rather than pushing the page out.
  table: ({ children, ...props }) => (
    <div className="table-wrap">
      <table {...props}>{children}</table>
    </div>
  ),
};

export const Markdown = memo(function Markdown({ children }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {linkCitations(String(children ?? ""))}
      </ReactMarkdown>
    </div>
  );
});
