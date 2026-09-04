import { memo, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Streaming markdown renderer for assistant answers.
 *
 * Follows the ElevenLabs UI Response API. Theirs wraps Streamdown, which is
 * styled with Tailwind; this renders through react-markdown against the
 * project's own CSS, so the dependency footprint stays at two small packages
 * instead of a whole styling framework.
 *
 * This is the single biggest visible upgrade in the interface. Course notes
 * are dense with commands, YAML and Dockerfiles. Rendered as plain text, a
 * fenced code block arrives as literal backticks and a table arrives as a
 * row of pipes -- which is precisely the content students most need to read
 * accurately.
 *
 * Memoized on `children`: during streaming this re-renders once per token,
 * and there is no reason to re-parse when a sibling changes instead.
 */

function CodeBlock({ children, className }) {
  const [copied, setCopied] = useState(false);
  const language = /language-(\w+)/.exec(className || "")?.[1];
  const text = String(children).replace(/\n$/, "");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access can be refused (insecure origin, or the user said
      // no). Failing quietly is right: the code is on screen and can be
      // selected by hand.
    }
  }

  return (
    <div className="codeblock">
      <div className="codeblock-bar">
        <span className="lang">{language || "code"}</span>
        <button type="button" onClick={copy} className="copy">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code className={className}>{text}</code>
      </pre>
    </div>
  );
}

const components = {
  code({ inline, className, children, ...props }) {
    // react-markdown reports inline code without a language class. Fenced
    // blocks get one, and only those deserve the header and copy button.
    const isFenced = !inline && /language-/.test(className || "");
    if (isFenced) return <CodeBlock className={className}>{children}</CodeBlock>;
    return (
      <code className="inline-code" {...props}>
        {children}
      </code>
    );
  },
  pre({ children }) {
    // CodeBlock renders its own <pre>; without this we would nest two.
    return <>{children}</>;
  },
  a({ children, href, ...props }) {
    return (
      <a href={href} target="_blank" rel="noreferrer noopener" {...props}>
        {children}
      </a>
    );
  },
  table({ children, ...props }) {
    // Wide tables scroll inside themselves rather than pushing the page out.
    return (
      <div className="table-scroll">
        <table {...props}>{children}</table>
      </div>
    );
  },
};

export const Response = memo(function Response({ children, className = "" }) {
  return (
    <div className={`response ${className}`}>
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {String(children ?? "")}
      </Markdown>
    </div>
  );
});
