import { Button } from "@mui/material";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import { useNavigate } from "react-router-dom";
import { tourStops } from "../tourStops.js";
import MarkdownPage from "../components/MarkdownPage.js";
import PageContainer from "../components/layout/PageContainer.js";
import content from "../content/welcome.md?raw";

export default function Welcome() {
  const navigate = useNavigate();

  return (
    <PageContainer>
      <MarkdownPage content={content} />

      <Button
        variant="contained"
        size="large"
        endIcon={<PlayArrowIcon />}
        onClick={() => navigate(tourStops[1].path)}
        sx={{ mt: 2 }}
      >
        Start the tour
      </Button>
    </PageContainer>
  );
}
