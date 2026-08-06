import MarkdownPage from "../components/MarkdownPage.js";
import PageContainer from "../components/layout/PageContainer.js";
import content from "../content/eip-7906-explained.md?raw";

export default function EIP7906Explained() {
  return (
    <PageContainer>
      <MarkdownPage content={content} />
    </PageContainer>
  );
}
