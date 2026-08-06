import { Box, Divider, Link as MuiLink, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from "@mui/material";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import CodeBlock from "./CodeBlock.js";

const components: Components = {
  h1: ({ children }) => (
    <Typography variant="h4" sx={{ mb: 2 }}>{children}</Typography>
  ),
  h2: ({ children }) => (
    <>
      <Divider sx={{ mt: 5, mb: 3 }} />
      <Typography variant="h5" sx={{ mb: 2 }}>{children}</Typography>
    </>
  ),
  h3: ({ children }) => (
    <Typography variant="h6" sx={{ mt: 3, mb: 1.5 }}>{children}</Typography>
  ),
  p: ({ children }) => (
    <Typography variant="body1" color="text.secondary" sx={{ mb: 2, lineHeight: 1.7 }}>{children}</Typography>
  ),
  a: ({ href, children }) => (
    <MuiLink href={href} target="_blank" rel="noopener noreferrer">{children}</MuiLink>
  ),
  ul: ({ children }) => (
    <Box component="ul" sx={{ pl: 3, mb: 2 }}>{children}</Box>
  ),
  ol: ({ children }) => (
    <Box component="ol" sx={{ pl: 3, mb: 2 }}>{children}</Box>
  ),
  li: ({ children }) => (
    <Typography component="li" variant="body1" color="text.secondary" sx={{ mb: 0.75, lineHeight: 1.7 }}>
      {children}
    </Typography>
  ),
  blockquote: ({ children }) => (
    <Box
      sx={{
        borderLeft: 3, borderColor: "primary.main", pl: 2, py: 0.5, mb: 2,
        fontStyle: "italic", color: "text.secondary",
      }}
    >
      {children}
    </Box>
  ),
  hr: () => <Divider sx={{ my: 4 }} />,
  code: ({ className, children }) => {
    const isBlock = /language-/.test(className ?? "");
    if (isBlock) return <CodeBlock>{String(children).replace(/\n$/, "")}</CodeBlock>;
    return (
      <Box
        component="code"
        sx={{
          fontFamily: '"IBM Plex Mono", monospace', fontSize: "0.875em", bgcolor: "action.hover",
          px: 0.6, py: 0.1, borderRadius: 0.5,
        }}
      >
        {children}
      </Box>
    );
  },
  table: ({ children }) => (
    <TableContainer sx={{ mb: 3, border: 1, borderColor: "divider", borderRadius: 1 }}>
      <Table size="small">{children}</Table>
    </TableContainer>
  ),
  thead: ({ children }) => <TableHead>{children}</TableHead>,
  tbody: ({ children }) => <TableBody>{children}</TableBody>,
  tr: ({ children }) => <TableRow>{children}</TableRow>,
  th: ({ children }) => <TableCell sx={{ fontWeight: 700 }}>{children}</TableCell>,
  td: ({ children }) => <TableCell sx={{ color: "text.secondary" }}>{children}</TableCell>,
};

export default function MarkdownPage({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {content}
    </ReactMarkdown>
  );
}
