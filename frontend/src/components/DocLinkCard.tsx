import { Box, Chip, Paper, Stack, Typography } from "@mui/material";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";

export interface DocLinkCardProps {
  title: string;
  description: string;
  url: string;
  accent: string;
  tag?: string;
}

function domain(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

export default function DocLinkCard({ title, description, url, accent, tag }: DocLinkCardProps) {
  return (
    <Paper
      component="a"
      href={url}
      target="_blank"
      rel="noreferrer"
      variant="outlined"
      sx={{
        display: "block",
        textDecoration: "none",
        color: "inherit",
        borderLeft: `3px solid ${accent}`,
        p: 2,
        transition: "background-color 0.15s",
        "&:hover": { bgcolor: "action.hover" },
        "&:hover .doc-title": { color: accent },
      }}
    >
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
            <Typography
              className="doc-title"
              variant="subtitle2"
              sx={{ transition: "color 0.15s" }}
            >
              {title}
            </Typography>
            {tag && (
              <Chip label={tag} size="small" variant="outlined" sx={{ height: 18, fontSize: 10, borderColor: accent, color: accent }} />
            )}
          </Stack>
          <Typography variant="caption" sx={{ color: "text.disabled", display: "block", mb: 0.75 }}>
            {domain(url)}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.5 }}>
            {description}
          </Typography>
        </Box>
        <OpenInNewIcon sx={{ fontSize: 15, color: "text.disabled", flexShrink: 0, mt: 0.25 }} />
      </Stack>
    </Paper>
  );
}
