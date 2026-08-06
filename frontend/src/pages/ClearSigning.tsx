import {
  Chip,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import PageContainer from "../components/layout/PageContainer.js";
import Section from "../components/layout/Section.js";

const ARCHITECTURE_POST_URL = "https://forshtat.com/posts/trustless-clear-signing-architecture/";

export default function ClearSigning() {
  return (
    <PageContainer>
      <Typography variant="h5" gutterBottom>Architecture &amp; Clear Signing</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        The full design write-up lives outside this demo — read it below, or dive straight into the
        TL;DR and the working example.
      </Typography>

      <Paper
        component="a"
        href={ARCHITECTURE_POST_URL}
        target="_blank"
        rel="noreferrer"
        variant="outlined"
        sx={{
          display: "block",
          textDecoration: "none",
          color: "inherit",
          p: 3,
          mb: 3,
          borderLeft: 3,
          borderColor: "primary.main",
          transition: "background-color 0.15s",
          "&:hover": { bgcolor: "action.hover" },
        }}
      >
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
          <Chip
            label="External write-up"
            size="small"
            variant="outlined"
            sx={{ borderColor: "primary.main", color: "primary.main" }}
          />
          <Typography variant="caption" color="text.disabled">forshtat.com</Typography>
        </Stack>
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={2}>
          <Typography variant="h5">Architecture for Trustless Clear Signing on Ethereum</Typography>
          <OpenInNewIcon sx={{ color: "text.disabled", mt: 0.5, flexShrink: 0 }} />
        </Stack>
        <Typography variant="body2" sx={{ mt: 1.5, fontWeight: 600, color: "primary.main" }}>
          Read the full write-up &rarr;
        </Typography>
      </Paper>

      <Section title="TL;DR" sx={{ mb: 0 }}>
        <Typography variant="body1" color="text.secondary" sx={{ lineHeight: 1.7, mb: 2 }}>
          A guide to changing the transaction signing experience from &ldquo;sign some bytes and pray
          to all the gods&rdquo;, through &ldquo;sign some inputs and hope for correct outcomes&rdquo;,
          all the way to &ldquo;sign desired outcomes and sleep easy&rdquo;. Built from many existing
          parts — the solution is much easier than it may seem.
        </Typography>
      </Section>
    </PageContainer>
  );
}
