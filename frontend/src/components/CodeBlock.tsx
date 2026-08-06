import { Box } from "@mui/material";

export default function CodeBlock({ children }: { children: string }) {
  return (
    <Box
      component="pre"
      sx={{
        mt: 2, mb: 0, p: 2,
        bgcolor: "grey.900",
        borderRadius: 1,
        border: "1px solid",
        borderColor: "divider",
        fontFamily: "monospace",
        fontSize: 12,
        lineHeight: 1.6,
        overflowX: "auto",
        whiteSpace: "pre",
        color: "grey.100",
      }}
    >
      {children}
    </Box>
  );
}
