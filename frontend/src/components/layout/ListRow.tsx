import { Paper, Box, Typography } from "@mui/material";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import type { ReactNode } from "react";

export default function ListRow({
  icon,
  eyebrow,
  title,
  description,
  tone = "neutral",
  onClick,
}: {
  icon?: ReactNode;
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  tone?: "neutral" | "accent";
  onClick?: () => void;
}) {
  const accent = tone === "accent";
  return (
    <Paper
      variant="outlined"
      onClick={onClick}
      sx={{
        p: accent ? 2.5 : 2,
        display: "flex",
        alignItems: "center",
        gap: 2,
        bgcolor: "background.elevated",
        cursor: onClick ? "pointer" : "default",
        borderColor: accent ? "warning.main" : "divider",
        borderWidth: accent ? 1.5 : 1,
        transition: "border-color 0.15s, background-color 0.15s",
        "&:hover": onClick
          ? { borderColor: accent ? "warning.main" : "primary.main", bgcolor: "action.hover" }
          : undefined,
      }}
    >
      {icon && (
        <Box
          sx={{
            width: accent ? 44 : 36,
            height: accent ? 44 : 36,
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            bgcolor: accent ? "warning.main" : "background.paper",
            color: accent ? "warning.contrastText" : "text.secondary",
          }}
        >
          {icon}
        </Box>
      )}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {eyebrow && (
          <Typography variant="overline" color={accent ? "warning.main" : "text.secondary"} sx={{ lineHeight: 1 }}>
            {eyebrow}
          </Typography>
        )}
        <Typography variant="body1" fontWeight={accent ? 700 : 600} sx={{ lineHeight: 1.3 }}>
          {title}
        </Typography>
        {description && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            {description}
          </Typography>
        )}
      </Box>
      {onClick && <ChevronRightIcon sx={{ color: "text.disabled", flexShrink: 0 }} />}
    </Paper>
  );
}
