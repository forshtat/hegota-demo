import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { formatEther } from "ethers";
import type { TransactionResponse, TransactionReceipt } from "ethers";
import {
  Typography, Paper, Stack, Chip, Divider, CircularProgress, Alert,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { useWallet } from "../contexts/WalletContext.js";
import PageContainer from "../components/layout/PageContainer.js";
import DataField from "../components/layout/DataField.js";
import { formatWalletError } from "../errorFormat.js";

export default function TxDetail() {
  const { hash } = useParams<{ hash: string }>();
  const { signer } = useWallet();
  const [tx, setTx] = useState<TransactionResponse | null>(null);
  const [receipt, setReceipt] = useState<TransactionReceipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hash || !signer?.provider) { setLoading(false); return; }
    const provider = signer.provider;
    Promise.all([
      provider.getTransaction(hash),
      provider.getTransactionReceipt(hash),
    ])
      .then(([t, r]) => { setTx(t); setReceipt(r); })
      .catch((e) => setError(formatWalletError(e)))
      .finally(() => setLoading(false));
  }, [hash, signer]);

  return (
    <PageContainer>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 3 }}>
        <Link to="/" style={{ display: "flex", alignItems: "center", color: "inherit", opacity: 0.6 }}>
          <ArrowBackIcon fontSize="small" />
        </Link>
        <Typography variant="h6">
          Transaction
        </Typography>
        {receipt && (
          receipt.status === 1
            ? <Chip icon={<CheckCircleIcon />} label="Success" color="success" size="small" />
            : <Chip icon={<ErrorIcon />} label="Failed" color="error" size="small" />
        )}
      </Stack>

      {!signer && !loading && (
        <Alert severity="warning">Connect your wallet to look up transaction details.</Alert>
      )}

      {loading && signer && (
        <Stack direction="row" alignItems="center" spacing={1}>
          <CircularProgress size={16} />
          <Typography variant="body2" color="text.secondary">Loading…</Typography>
        </Stack>
      )}

      {error && (
        <Typography variant="body2" color="error.main">{error}</Typography>
      )}

      {!loading && !error && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={1.25}>
            <DataField label="Tx hash" value={hash} />
            <Divider />
            <DataField label="Block" value={receipt?.blockNumber ?? "pending"} />
            <DataField label="From" value={tx?.from ?? "—"} />
            <DataField label="To" value={tx?.to ?? "—"} />
            <DataField label="Value" value={tx ? `${formatEther(tx.value)} ETH` : "—"} />
            <DataField
              label="Gas used"
              value={receipt ? `${receipt.gasUsed.toString()} / ${tx?.gasLimit.toString() ?? "?"}` : "—"}
            />
            <DataField
              label="Gas price"
              value={tx?.gasPrice ? `${(tx.gasPrice / 1_000_000_000n).toString()} gwei` : "—"}
            />
            {tx && tx.data !== "0x" && (
              <>
                <Divider />
                <DataField
                  label="Input data"
                  value={tx.data.length > 130 ? `${tx.data.slice(0, 130)}…` : tx.data}
                />
              </>
            )}
          </Stack>
        </Paper>
      )}
    </PageContainer>
  );
}
