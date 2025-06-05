import { create } from 'zustand';
import { ethers } from 'ethers';

interface NetworkInfo {
  name: string;
  chainId: number;
  symbol: string;
}

export const SUPPORTED_NETWORKS: NetworkInfo[] = [
  { name: 'Ethereum', chainId: 1, symbol: 'ETH' },
  { name: 'BSC', chainId: 56, symbol: 'BNB' },
  { name: 'Arbitrum', chainId: 42161, symbol: 'ETH' },
  { name: 'Polygon', chainId: 137, symbol: 'MATIC' }
];

interface Transaction {
  hash: string;
  timestamp: number;
  recipients: string[];
  amounts: string[];
  token?: string;
}

interface RainmakerStore {
  account: string | null;
  chainId: number | null;
  transactions: Transaction[];
  isLoading: boolean;
  setAccount: (account: string | null) => void;
  setChainId: (chainId: number | null) => void;
  addTransaction: (tx: Transaction) => void;
  setLoading: (loading: boolean) => void;
}

export const useRainmakerStore = create<RainmakerStore>((set) => ({
  account: null,
  chainId: null,
  transactions: [],
  isLoading: false,
  setAccount: (account) => set({ account }),
  setChainId: (chainId) => set({ chainId }),
  addTransaction: (tx) => set((state) => ({ 
    transactions: [tx, ...state.transactions] 
  })),
  setLoading: (isLoading) => set({ isLoading })
}));