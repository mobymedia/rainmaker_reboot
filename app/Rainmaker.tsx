// Rainmaker.tsx
"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import { ethers } from "ethers";
import { CloudRain, Upload, Wallet, Zap, History, RefreshCw } from "lucide-react";
import Head from "next/head";
import toast, { Toaster } from "react-hot-toast";
import { motion } from "framer-motion";
import Papa from "papaparse";
import { useRainmakerStore, SUPPORTED_NETWORKS } from "./store";

const ABI = [
  "function disperseEther(address[] recipients, uint256[] values) external payable",
  "function disperseToken(address token, address[] recipients, uint256[] values) external",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)"
];

const CONTRACTS: Record<number, string> = {
  1: "0xD375BA042B41A61e36198eAd6666BC0330649403",
  56: "0x41c57d044087b1834379CdFE1E09b18698eC3A5A",
  42161: "0x06b9d57Ba635616F41E85D611b2DA58856176Fa9",
  137: "0xD375BA042B41A61e36198eAd6666BC0330649403"
};

const BATCH_SIZE = 200;

export default function Rainmaker() {
  const { 
    account, 
    chainId, 
    transactions,
    isLoading,
    setAccount, 
    setChainId,
    addTransaction,
    setLoading
  } = useRainmakerStore();

  const [inputText, setInputText] = useState("");
  const [tokenAddress, setTokenAddress] = useState("");
  const [tokenInfo, setTokenInfo] = useState<{ symbol: string; balance: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentNetwork = useMemo(() => 
    SUPPORTED_NETWORKS.find(n => n.chainId === chainId),
    [chainId]
  );

  useEffect(() => {
    const history = localStorage.getItem("rainmaker-history");
    if (history) setInputText(history);

    // Setup network change listener
    if (window.ethereum) {
      window.ethereum.on('chainChanged', (chainId: string) => {
        setChainId(parseInt(chainId));
      });
      window.ethereum.on('accountsChanged', (accounts: string[]) => {
        setAccount(accounts[0] || null);
      });
    }

    return () => {
      if (window.ethereum) {
        window.ethereum.removeListener('chainChanged', () => {});
        window.ethereum.removeListener('accountsChanged', () => {});
      }
    };
  }, []);

  useEffect(() => {
    localStorage.setItem("rainmaker-history", inputText);
  }, [inputText]);

  useEffect(() => {
    if (!account || !tokenAddress || !window.ethereum) return;
    
    const fetchTokenInfo = async () => {
      try {
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        const tokenContract = new ethers.Contract(tokenAddress, ABI, provider);
        const [symbol, decimals, balance] = await Promise.all([
          tokenContract.symbol(),
          tokenContract.decimals(),
          tokenContract.balanceOf(account)
        ]);
        
        setTokenInfo({
          symbol,
          balance: ethers.utils.formatUnits(balance, decimals)
        });
      } catch (err) {
        setTokenInfo(null);
      }
    };

    fetchTokenInfo();
  }, [account, tokenAddress]);

  const connectWallet = async () => {
    if (!window.ethereum) return toast.error("MetaMask not detected");
    try {
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const accounts = await provider.send("eth_requestAccounts", []);
      const network = await provider.getNetwork();
      
      setAccount(accounts[0]);
      setChainId(network.chainId);
      toast.success("Wallet connected");
    } catch (err: any) {
      toast.error(err.message || "Failed to connect wallet");
    }
  };

  const switchNetwork = async (chainId: number) => {
    if (!window.ethereum) return;
    
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${chainId.toString(16)}` }],
      });
    } catch (err: any) {
      toast.error(`Failed to switch network: ${err.message}`);
    }
  };

  const handleCSVUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    Papa.parse(file, {
      complete: (results) => {
        const lines = results.data as string[][];
        const formatted = lines
          .filter(row => row.length >= 2)
          .map(row => row.slice(0, 2).join(","))
          .join("\n");
        setInputText(formatted);
        toast.success("CSV uploaded successfully");
      },
      error: () => toast.error("CSV parsing failed")
    });
  };

  const validateInput = (lines: string[]): { recipients: string[]; amounts: string[] } | null => {
    const recipients: string[] = [];
    const amounts: string[] = [];

    for (const line of lines) {
      const parts = line.split(/[\s,]+/).map(s => s.trim());
      if (parts.length !== 2) {
        toast.error(`Invalid line format: "${line}"`);
        return null;
      }

      const [addr, amount] = parts;
      if (!ethers.utils.isAddress(addr)) {
        toast.error(`Invalid address: ${addr}`);
        return null;
      }

      try {
        // Validate amount is a valid number
        if (isNaN(Number(amount)) || Number(amount) <= 0) {
          throw new Error(`Invalid amount: ${amount}`);
        }
        recipients.push(addr);
        amounts.push(amount);
      } catch (err: any) {
        toast.error(err.message);
        return null;
      }
    }

    return { recipients, amounts };
  };

  const handleSend = async () => {
    if (!window.ethereum) return toast.error("No wallet found");
    if (!chainId || !CONTRACTS[chainId]) return toast.error("Unsupported network");
    
    setLoading(true);
    
    try {
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const signer = provider.getSigner();
      const contractAddress = CONTRACTS[chainId];
      const contract = new ethers.Contract(contractAddress, ABI, signer);

      const lines = inputText.trim().split("\n").filter(line => line.trim() !== "");
      if (lines.length === 0) return toast.error("No recipients specified");
      
      const validated = validateInput(lines);
      if (!validated) return;
      
      const { recipients, amounts } = validated;

      // Process in batches
      for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
        const batchRecipients = recipients.slice(i, i + BATCH_SIZE);
        const batchAmounts = amounts.slice(i, i + BATCH_SIZE);

        let tx;
        if (tokenAddress.trim() === "") {
          const batchTotal = batchAmounts.reduce(
            (sum, amount) => sum.add(ethers.utils.parseEther(amount)),
            ethers.BigNumber.from(0)
          );

          tx = await contract.disperseEther(batchRecipients, batchAmounts.map(a => 
            ethers.utils.parseEther(a)), { value: batchTotal });
        } else {
          const parsedTokenAddress = ethers.utils.getAddress(tokenAddress.trim());
          const tokenContract = new ethers.Contract(parsedTokenAddress, ABI, signer);
          
          const decimals = await tokenContract.decimals();
          const batchTotal = batchAmounts.reduce(
            (sum, amount) => sum.add(ethers.utils.parseUnits(amount, decimals)),
            ethers.BigNumber.from(0)
          );

          const userAddress = await signer.getAddress();
          const allowance = await tokenContract.allowance(userAddress, contractAddress);

          if (allowance.lt(batchTotal)) {
            const approvalTx = await tokenContract.approve(contractAddress, batchTotal);
            toast.success("Approval tx sent: " + approvalTx.hash);
            await approvalTx.wait();
          }

          tx = await contract.disperseToken(
            parsedTokenAddress,
            batchRecipients,
            batchAmounts.map(a => ethers.utils.parseUnits(a, decimals))
          );
        }

        toast.success("Transaction sent: " + tx.hash);
        await tx.wait();
        
        addTransaction({
          hash: tx.hash,
          timestamp: Date.now(),
          recipients: batchRecipients,
          amounts: batchAmounts,
          token: tokenAddress || null
        });
      }

      toast.success("All transactions confirmed ✅");
    } catch (err: any) {
      toast.error(err.message || "Transaction failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Rainmaker – Multisend</title>
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <Toaster position="bottom-right" />
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5 }}
        className="min-h-screen bg-gradient-to-br from-[#0f0f0f] to-[#1a1a2e] text-white p-6 md:p-12 font-sans"
      >
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="rounded-2xl bg-[#1c1c2c] shadow-xl border border-gray-700 overflow-hidden">
            <div className="bg-[#10101a] p-6 md:p-8 border-b border-gray-700">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <h1 className="text-3xl md:text-4xl font-bold flex items-center gap-3">
                  <CloudRain className="w-7 h-7 md:w-9 md:h-9 text-blue-400" /> Rainmaker
                </h1>
                <div className="flex items-center gap-2">
                  {currentNetwork && (
                    <div className="bg-[#2a2a3d] px-3 py-1.5 rounded-lg text-sm">
                      {currentNetwork.name}
                    </div>
                  )}
                  <button
                    onClick={connectWallet}
                    className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 px-4 py-2 rounded-lg text-sm font-semibold"
                  >
                    <Wallet className="w-4 h-4" />
                    {account ? `${account.slice(0, 6)}...${account.slice(-4)}` : "Connect Wallet"}
                  </button>
                </div>
              </div>
              <div className="mt-4 flex gap-2 flex-wrap">
                {SUPPORTED_NETWORKS.map((network) => (
                  <button
                    key={network.chainId}
                    onClick={() => switchNetwork(network.chainId)}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                      chainId === network.chainId
                        ? "bg-blue-600 text-white"
                        : "bg-[#2a2a3d] text-gray-300 hover:bg-[#3a3a4d]"
                    }`}
                  >
                    {network.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="p-6 md:p-8 space-y-6">
              <div>
                <label className="block text-sm font-semibold mb-2 text-gray-300">Wallets & Amounts</label>
                <textarea
                  className="w-full h-48 p-4 text-sm rounded-lg bg-[#2a2a3d] text-white border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder="0xabc123...,0.1&#13;&#10;0xdef456...,0.25"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2 text-gray-300">
                  Token Address{" "}
                  <span className="text-yellow-400">
                    (leave blank for {currentNetwork?.symbol || "native token"})
                  </span>
                </label>
                <div className="flex gap-4 items-center">
                  <input
                    type="text"
                    placeholder="Enter token contract address"
                    className="flex-1 p-3 text-sm rounded-md bg-[#2a2a3d] text-white border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={tokenAddress}
                    onChange={(e) => setTokenAddress(e.target.value)}
                  />
                  {tokenInfo && (
                    <div className="bg-[#2a2a3d] px-4 py-2 rounded-lg">
                      <p className="text-sm font-medium">{tokenInfo.symbol}</p>
                      <p className="text-xs text-gray-400">Balance: {tokenInfo.balance}</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-4 items-center">
                <button
                  onClick={handleSend}
                  disabled={isLoading}
                  className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold shadow-md transition-all ${
                    isLoading
                      ? "bg-gray-600 cursor-not-allowed"
                      : "bg-green-600 hover:bg-green-700"
                  }`}
                >
                  {isLoading ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Zap className="w-4 h-4" />
                  )}
                  {isLoading ? "Processing..." : "Send"}
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 px-6 py-2.5 rounded-lg text-sm font-semibold shadow-md transition-all"
                >
                  <Upload className="w-4 h-4" /> Upload CSV
                </button>
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleCSVUpload}
                  className="hidden"
                  ref={fileInputRef}
                />
              </div>

              {transactions.length > 0 && (
                <div className="mt-8">
                  <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
                    <History className="w-5 h-5" /> Recent Transactions
                  </h2>
                  <div className="space-y-2">
                    {transactions.slice(0, 5).map((tx) => (
                      <div
                        key={tx.hash}
                        className="bg-[#2a2a3d] p-4 rounded-lg"
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="text-sm font-medium">
                              {tx.hash.slice(0, 8)}...{tx.hash.slice(-6)}
                            </p>
                            <p className="text-xs text-gray-400">
                              {new Date(tx.timestamp).toLocaleString()}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm">
                              {tx.recipients.length} recipients
                            </p>
                            <p className="text-xs text-gray-400">
                              {tx.token ? "Token" : "Native"} transfer
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    </>
  );
}