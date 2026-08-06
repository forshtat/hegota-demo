import { Link as MuiLink, Typography, type SxProps, type Theme } from "@mui/material";
import { doraTxUrl } from "../dora.js";

export default function DoraLink({ txHash, sx }: { txHash: string; sx?: SxProps<Theme> }) {
  return (
    <Typography variant="caption" sx={{ display: "block", mt: 0.75, ...sx }}>
      <MuiLink href={doraTxUrl(txHash)} target="_blank" rel="noopener noreferrer" underline="hover">
        View transaction on Dora ↗
      </MuiLink>
    </Typography>
  );
}
