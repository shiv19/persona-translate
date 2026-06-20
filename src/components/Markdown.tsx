import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeSanitize from "rehype-sanitize"

/**
 * Markdown renderer for AI tutor answers. Two layers of safety:
 *  - react-markdown v10+ does not render raw HTML by default (it passes
 *    through as text), so `<script>` tags never execute.
 *  - rehype-sanitize is the explicit second layer that strips any HTML the
 *    model might emit via the few elements react-markdown does pass through.
 *
 * `remark-gfm` enables GitHub-Flavored Markdown — tables, strikethrough, task
 * lists, autolinks. Without it react-markdown v10 parses CommonMark only, so
 * the Ask prompt's "tables are great for pronoun paradigms" guidance rendered
 * tables as literal pipe text. The default sanitize schema allows table tags,
 * so tables survive both layers.
 *
 * Styling lives in index.css under `.markdown-body`.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
