import { memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Markdown rendering for answers.
 *
 * Code blocks get the most attention here on purpose. This is a product for
 * a coding school: answers are full of Dockerfiles, YAML, shell commands and
 * kubectl invocations, and those are the parts a student will copy and run.
 * A block that renders as literal backticks, or wraps a command across two
 * lines, actively costs them time.
 *
 * Memoized on content: during streaming this re-renders on every token.
 */

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
        <code>{text}</code>
      </pre>
    </div>
  );
}

const components = {
  code({ inline, className, children, ...props }) {
    const fenced = !inline && /language-/.test(className || "");
    if (fenced) return <CodeBlock className={className}>{children}</CodeBlock>;
    return (
      <code className="inline" {...props}>
        {children}
      </code>
    );
  },
  // CodeBlock renders its own <pre>; without this the two would nest.
  pre: ({ children }) => <>{children}</>,
  a: ({ children, href, ...props }) => (
    <a href={href} target="_blank" rel="noreferrer noopener" {...props}>
      {children}
    </a>
  ),
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
        {String(children ?? "")}
      </ReactMarkdown>
    </div>
  );
});
