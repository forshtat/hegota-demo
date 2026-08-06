import "./index.css";
import { maybeInstallAutoWallet } from "./devAutoWallet.js";
maybeInstallAutoWallet();
import "./wallet.js";
import { registerAllAddresses } from "./contracts/registerAll.js";
registerAllAddresses();
import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import { SnackbarProvider } from "notistack";
import App from "./App.js";
import theme from "./theme.js";
import { WalletProvider } from "./contexts/WalletContext.js";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {/* maxSnack=3 so a burst of activity (e.g. fund+approve back to back) doesn't wall off
          the screen; each toast still auto-dismisses on its own timer underneath. */}
      <SnackbarProvider maxSnack={3} anchorOrigin={{ vertical: "top", horizontal: "right" }}>
        <WalletProvider>
          <App />
        </WalletProvider>
      </SnackbarProvider>
    </ThemeProvider>
  </StrictMode>,
);
