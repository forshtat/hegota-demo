import { Box, Button, Stack, Typography } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { useNavigate } from "react-router-dom";
import { useTour } from "../../contexts/TourContext.js";
import { tourStops } from "../../tourStops.js";

export default function TourBar() {
  const navigate = useNavigate();
  const { currentIndex, totalStops, scrolledToBottom, markComplete } = useTour();

  const isOnTour = currentIndex !== null;
  const isLastStop = currentIndex === totalStops - 1;
  const isFirstStop = currentIndex === 0;

  function handleNext() {
    if (!isOnTour) {
      navigate(tourStops[0].path);
      return;
    }
    const currentStop = tourStops[currentIndex];
    if (!currentStop.requiresAction && scrolledToBottom.has(currentStop.path)) {
      markComplete(currentStop.path);
    }
    const nextIndex = isLastStop ? 0 : currentIndex + 1;
    navigate(tourStops[nextIndex].path);
  }

  function handleBack() {
    if (!isOnTour || isFirstStop) return;
    navigate(tourStops[currentIndex - 1].path);
  }

  return (
    <Stack
      direction="row"
      alignItems="center"
      justifyContent="space-between"
      spacing={2}
      sx={{
        position: "sticky",
        top: 0,
        zIndex: (theme) => theme.zIndex.appBar,
        px: 3,
        py: 1.25,
        bgcolor: "background.paper",
        borderBottom: 1,
        borderColor: "divider",
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        {isOnTour ? (
          <Stack direction="row" spacing={1.5} alignItems="baseline">
            <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
              Step {currentIndex + 1}/{totalStops}
            </Typography>
            <Typography variant="body2" noWrap sx={{ fontSize: 13 }}>
              {tourStops[currentIndex].caption}
            </Typography>
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ fontSize: 13 }}>
            Not on the guided tour right now.
          </Typography>
        )}
      </Box>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0 }}>
        {isOnTour && !isFirstStop && (
          <Button
            variant="contained"
            size="small"
            onClick={handleBack}
            startIcon={<ArrowBackIcon fontSize="small" />}
            sx={{
              bgcolor: "action.selected",
              color: "text.primary",
              "&:hover": { bgcolor: "action.hover" },
            }}
          >
            Back
          </Button>
        )}
        <Button variant="contained" size="small" onClick={handleNext}>
          {!isOnTour ? "Start tour" : isLastStop ? "Restart tour" : "Next"}
        </Button>
      </Stack>
    </Stack>
  );
}
