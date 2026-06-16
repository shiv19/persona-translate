import ReactMarkdown from "react-markdown"
import rehypeSanitize from "rehype-sanitize"

/**
 * Markdown renderer for AI tutor answers. Two layers of safety:
 *  - react-markdown v10+ does not render raw HTML by default (it passes
 *    through as text), so `<script>` tags never execute.
 *  - rehype-sanitize is the explicit second layer that strips any HTML the
 *    model might emit via the few elements react-markdown does pass through.
 *
 * Styling lives in index.css under `.markdown-body`.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{children}</ReactMarkdown>
    </div>
  )
}
