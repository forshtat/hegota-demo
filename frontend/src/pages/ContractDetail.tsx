import { useParams, Link as RouterLink } from "react-router-dom";
import { Box, Typography, Chip, Stack, Alert, Button } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import CodeIcon from "@mui/icons-material/Code";
import { lookupAddress } from "../contracts/addressRegistry.js";
import PageContainer from "../components/layout/PageContainer.js";

export default function ContractDetail() {
  const { address = "" } = useParams<{ address: string }>();
  const info = lookupAddress(address);

  return (
    <PageContainer maxWidth="wide">
      <Button
        component={RouterLink}
        to="/"
        startIcon={<ArrowBackIcon />}
        size="small"
        sx={{ mb: 3, opacity: 0.7 }}
        color="inherit"
      >
        Back
      </Button>

      {!info ? (
        <Alert severity="info">
          No contract info registered for <code>{address}</code>. Run Setup on a threat page first.
        </Alert>
      ) : (
        <>
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 0.5 }}>
            <CodeIcon color="action" />
            <Typography variant="h5">{info.name}</Typography>
          </Stack>

          {address.startsWith("0x") ? (
            <Chip
              label={address}
              size="small"
              variant="outlined"
              sx={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 11, mb: 2, opacity: 0.7 }}
            />
          ) : (
            <Chip
              label="embedded library — no deployed address"
              size="small"
              variant="outlined"
              sx={{ fontSize: 11, mb: 2, opacity: 0.7 }}
            />
          )}

          {info.description && (
            <Box
              component="pre"
              sx={{
                mt: 0, mb: 2, p: 2,
                bgcolor: "grey.900",
                borderRadius: 1,
                border: "1px solid",
                borderColor: "divider",
                fontFamily: '"IBM Plex Mono", monospace',
                fontSize: 12,
                lineHeight: 1.6,
                overflowX: "auto",
                whiteSpace: "pre-wrap",
                color: "info.light",
              }}
            >
              {info.description}
            </Box>
          )}

          {info.source ? (
            <Box
              component="pre"
              sx={{
                mt: 0, p: 2,
                bgcolor: "grey.900",
                borderRadius: 1,
                border: "1px solid",
                borderColor: "divider",
                fontFamily: '"IBM Plex Mono", monospace',
                fontSize: 12,
                lineHeight: 1.6,
                overflowX: "auto",
                whiteSpace: "pre",
                color: "grey.100",
              }}
            >
              {info.source}
            </Box>
          ) : (
            <Alert severity="warning" sx={{ mt: 1 }}>
              No Solidity source available — this contract was deployed from hand-assembled bytecode.
            </Alert>
          )}
        </>
      )}
    </PageContainer>
  );
}
