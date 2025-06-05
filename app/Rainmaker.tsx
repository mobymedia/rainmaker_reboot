"use client";

import React, { useEffect, useState, useRef, useMemo } from "react";
import { ethers } from "ethers";
import { CloudRain, Upload, Wallet, Zap, History, RefreshCw, Info, X, LogOut } from "lucide-react";
import Head from "next/head";
import toast, { Toaster } from "react-hot-toast";
import { motion, AnimatePresence } from "framer-motion";
import Papa from "papaparse";
import { Dialog, Transition } from '@headlessui/react';
import { useRainmakerStore, SUPPORTED_NETWORKS } from "./store";

// Extended ABI to support more token standards
const ABI = [
  "function disperseEther(address[] recipients, uint256[] values) external payable",
  "function disperseToken(address token, address[] recipients, uint256[] values) external",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  // Fallback functions for tokens that might not implement name()
  "function NAME() view returns (string)",
  "function SYMBOL() view returns (string)"
];

const CONTRACTS: Record<number, string> = {
  1: "0xD375BA042B41A61e36198eAd6666BC0330649403",
  56: "0x41c57d044087b1834379CdFE1E09b18698eC3A5A",
  42161: "0x06b9d57Ba635616F41E85D611b2DA58856176Fa9",
  137: "0xD375BA042B41A61e36198eAd6666BC0330649403"
};

const BATCH_SIZE = 200;

// Common token addresses
const KNOWN_TOKENS: Record<number, Record<string, string>> = {
  56: { // BSC
    'USDT': '0x55d398326f99059fF775485246999027B3197955',
    'BUSD': '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
    'USDC': '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d'
  }
};

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
  const [tokenInfo, setTokenInfo] = useState<{ symbol: string; name: string; balance: string } | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [recipientCount, setRecipientCount] = useState(0);
  const [totalAmount, setTotalAmount] = useState("0");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [tokenDetectionError, setTokenDetectionError] = useState<string | null>(null);

  const currentNetwork = useMemo(() => 
    SUPPORTED_NETWORKS.find(n => n.chainId === chainId),
    [chainId]
  );

  useEffect(() => {
    const history = localStorage.getItem("rainmaker-history");
    if (history) setInputText(history);

    if (window.ethereum) {
      window.ethereum.on('chainChanged', (chainId: string) => {
        setChainId(parseInt(chainId));
        // Clear token info when changing networks
        setTokenInfo(null);
        setTokenAddress("");
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
    
    const lines = inputText.trim().split("\n").filter(line => line.trim() !== "");
    setRecipientCount(lines.length);
    
    const total = lines.reduce((sum, line) => {
      const [, amount] = line.split(/[\s,]+/).map(s => s.trim());
      return sum + (isNaN(Number(amount)) ? 0 : Number(amount));
    }, 0);
    setTotalAmount(total.toFixed(4));
  }, [inputText]);

  useEffect(() => {
    if (!account || !tokenAddress || !window.ethereum) {
      setTokenInfo(null);
      setTokenDetectionError(null);
      return;
    }

    const fetchTokenInfo = async () => {
      setTokenDetectionError(null);
      try {
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        const address = ethers.utils.getAddress(tokenAddress.trim()); // Validate & checksum the address
        const tokenContract = new ethers.Contract(address, ABI, provider);

        let symbol, name, decimals, balance;

        try {
          [symbol, name, decimals, balance] = await Promise.all([
            tokenContract.symbol(),
            tokenContract.name(),
            tokenContract.decimals(),
            tokenContract.balanceOf(account)
          ]);
        } catch (err) {
          // Fallback for tokens that might use uppercase functions
          [symbol, name, decimals, balance] = await Promise.all([
            tokenContract.SYMBOL(),
            tokenContract.NAME(),
            tokenContract.decimals(),
            tokenContract.balanceOf(account)
          ]);
        }

        setTokenInfo({
          symbol,
          name,
          balance: ethers.utils.formatUnits(balance, decimals)
        });
        toast.success(`Detected ${name} (${symbol})`);
      } catch (err: any) {
        console.error('Token detection error:', err);
        setTokenInfo(null);
        const errorMessage = err.message.includes('call revert exception') 
          ? 'Invalid token contract address'
          : 'Failed to detect token';
        setTokenDetectionError(errorMessage);
        toast.error(errorMessage);
      }
    };

    const debounceTimer = setTimeout(fetchTokenInfo, 500);
    return () => clearTimeout(debounceTimer);
  }, [account, tokenAddress, chainId]);

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

  const disconnectWallet = () => {
    setAccount(null);
    setChainId(null);
    setTokenInfo(null);
    setTokenAddress("");
    toast.success("Wallet disconnected");
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
        className="min-h-screen bg-gradient-to-br from-dark-900 to-dark-700 text-white p-6 md:p-12 font-sans"
      >
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="gradient-border">
            <div className="glass-effect rounded-2xl overflow-hidden">
              <div className="bg-dark-800/50 p-6 md:p-8 border-b border-white/10">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <h1 className="text-3xl md:text-4xl font-bold flex items-center gap-3">
                    <CloudRain className="w-7 h-7 md:w-9 md:h-9 text-primary-400" /> Rainmaker
                  </h1>
                  <div className="flex items-center gap-2">
                    {currentNetwork && (
                      <div className="glass-effect px-3 py-1.5 rounded-lg text-sm">
                        {currentNetwork.name}
                      </div>
                    )}
                    {account ? (
                      <div className="flex gap-2">
                        <motion.button
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          className="flex items-center gap-2 bg-gradient-to-r from-primary-600 to-primary-500 hover:from-primary-700 hover:to-primary-600 px-4 py-2 rounded-lg text-sm font-semibold transition-all shadow-glow"
                        >
                          <Wallet className="w-4 h-4" />
                          {`${account.slice(0, 6)}...${account.slice(-4)}`}
                        </motion.button>
                        <motion.button
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={disconnectWallet}
                          className="flex items-center gap-2 bg-red-500 hover:bg-red-600 px-4 py-2 rounded-lg text-sm font-semibold transition-all"
                        >
                          <LogOut className="w-4 h-4" />
                          Disconnect
                        </motion.button>
                      </div>
                    ) : (
                      <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={connectWallet}
                        className="flex items-center gap-2 bg-gradient-to-r from-primary-600 to-primary-500 hover:from-primary-700 hover:to-primary-600 px-4 py-2 rounded-lg text-sm font-semibold transition-all shadow-glow"
                      >
                        <Wallet className="w-4 h-4" />
                        Connect Wallet
                      </motion.button>
                    )}
                  </div>
                </div>
                <div className="mt-4 flex gap-2 flex-wrap">
                  {SUPPORTED_NETWORKS.map((network) => (
                    <motion.button
                      key={network.chainId}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => switchNetwork(network.chainId)}
                      className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                        chainId === network.chainId
                          ? "bg-primary-600 text-white shadow-glow"
                          : "glass-effect text-gray-300 hover:bg-dark-700/50"
                      }`}
                    >
                      {network.name}
                    </motion.button>
                  ))}
                </div>
              </div>

              <div className="p-6 md:p-8 space-y-6">
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-sm font-semibold text-gray-300">Wallets & Amounts</label>
                    <div className="flex items-center gap-4 text-sm">
                      <span className="text-gray-400">Recipients: {recipientCount}</span>
                      <span className="text-gray-400">Total: {totalAmount} {currentNetwork?.symbol || ''}</span>
                      <motion.button
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => setIsPreviewOpen(true)}
                        className="text-primary-400 hover:text-primary-300 flex items-center gap-1"
                      >
                        <Info className="w-4 h-4" /> Preview
                      </motion.button>
                    </div>
                  </div>
                  <textarea
                    className="w-full h-48 p-4 text-sm rounded-lg glass-effect text-white border border-white/10 focus:outline-none focus:ring-2 focus:ring-primary-500 transition-all"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder="0xabc123...,0.1&#13;&#10;0xdef456...,0.25"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold mb-2 text-gray-300">
                    Token Address{" "}
                    <span className="text-primary-400">
                      (leave blank for {currentNetwork?.symbol || "native token"})
                    </span>
                  </label>
                  <div className="flex gap-4 items-center">
                    <input
                      type="text"
                      placeholder="Enter token contract address"
                      className="flex-1 p-3 text-sm rounded-md glass-effect text-white border border-white/10 focus:outline-none focus:ring-2 focus:ring-primary-500 transition-all"
                      value={tokenAddress}
                      onChange={(e) => setTokenAddress(e.target.value)}
                    />
                    {tokenInfo && (
                      <motion.div
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="glass-effect px-4 py-2 rounded-lg"
                      >
                        <p className="text-sm font-medium">{tokenInfo.name} ({tokenInfo.symbol})</p>
                        <p className="text-xs text-gray-400">Balance: {tokenInfo.balance}</p>
                      </motion.div>
                    )}
                    {tokenDetectionError && (
                      <motion.div
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="bg-red-500/20 text-red-400 px-4 py-2 rounded-lg text-sm"
                      >
                        {tokenDetectionError}
                      </motion.div>
                    )}
                  </div>
                  {chainId && KNOWN_TOKENS[chainId] && (
                    <div className="mt-2 flex gap-2">
                      {Object.entries(KNOWN_TOKENS[chainId]).map(([symbol, address]) => (
                        <button
                          key={symbol}
                          onClick={() => setTokenAddress(address)}
                          className="text-xs bg-primary-500/20 text-primary-400 px-2 py-1 rounded hover:bg-primary-500/30 transition-colors"
                        >
                          {symbol}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-4 items-center">
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleSend}
                    disabled={isLoading}
                    className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold shadow-glow transition-all ${
                      isLoading
                        ? "bg-gray-600 cursor-not-allowed"
                        : "bg-gradient-to-r from-green-600 to-green-500 hover:from-green-700 hover:to-green-600"
                    }`}
                  >
                    {isLoading ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Zap className="w-4 h-4" />
                    )}
                    {isLoading ? "Processing..." : "Send"}
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-2 bg-gradient-to-r from-primary-600 to-primary-500 hover:from-primary-700 hover:to-primary-600 px-6 py-2.5 rounded-lg text-sm font-semibold shadow-glow transition-all"
                  >
                    <Upload className="w-4 h-4" /> Upload CSV
                  </motion.button>
                  <input
                    type="file"
                    accept=".csv"
                    onChange={handleCSVUpload}
                    className="hidden"
                    ref={fileInputRef}
                  />
                </div>

                {transactions.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-8"
                  >
                    <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
                      <History className="w-5 h-5" /> Recent Transactions
                    </h2>
                    <div className="space-y-2">
                      {transactions.slice(0, 5).map((tx) => (
                        <motion.div
                          key={tx.hash}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          className="glass-effect p-4 rounded-lg hover:bg-dark-700/50 transition-all"
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
                        </motion.div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      <Transition show={isPreviewOpen} as={React.Fragment}>
        <Dialog
          as="div"
          className="fixed inset-0 z-10 overflow-y-auto"
          onClose={() => setIsPreviewOpen(false)}
        >
          <div className="min-h-screen px-4 text-center">
            <Transition.Child
              as={React.Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0"
              enterTo="opacity-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100"
              leaveTo="opacity-0"
            >
              <Dialog.Overlay className="fixed inset-0 bg-black bg-opacity-75 backdrop-blur-sm transition-opacity" />
            </Transition.Child>

            <span
              className="inline-block h-screen align-middle"
              aria-hidden="true"
            >
              &#8203;
            </span>
            
            <Transition.Child
              as={React.Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <div className="inline-block w-full max-w-2xl p-6 my-8 overflow-hidden text-left align-middle transition-all transform glass-effect rounded-2xl">
                <div className="flex justify-between items-center mb-4">
                  <Dialog.Title
                    as="h3"
                    className="text-lg font-medium leading-6 text-white"
                  >
                    Transaction Preview
                  </Dialog.Title>
                  <button
                    onClick={() => setIsPreviewOpen(false)}
                    className="text-gray-400 hover:text-white transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="mt-2">
                  <div className="space-y-4">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Total Recipients:</span>
                      <span className="text-white font-medium">{recipientCount}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Total Amount:</span>
                      <span className="text-white font-medium">
                        {totalAmount} {tokenInfo?.symbol || currentNetwork?.symbol || ''}
                      </span>
                    </div>
                    <div className="mt-4">
                      <div className="text-sm text-gray-400 mb-2">Recipients Preview:</div>
                      <div className="glass-effect rounded-lg p-4 max-h-60 overflow-y-auto">
                        {inputText.split('\n').slice(0, 5).map((line, index) => (
                          <div key={index} className="text-sm mb-2 last:mb-0">
                            {line}
                          </div>
                        ))}
                        {recipientCount > 5 && (
                          <div className="text-sm text-gray-400 mt-2">
                            ... and {recipientCount - 5} more
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </Transition.Child>
          </div>
        </Dialog>
      </Transition>
    </>
  );
}