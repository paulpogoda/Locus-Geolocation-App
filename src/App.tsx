import { useState, useCallback, useEffect, MouseEvent, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import { motion, AnimatePresence } from 'motion/react';
import { 
  MapPin, 
  Upload, 
  Loader2, 
  Info, 
  ChevronRight, 
  X, 
  Compass, 
  Search, 
  ExternalLink, 
  Globe, 
  Map as MapIcon, 
  Target, 
  Plus, 
  Minus, 
  History, 
  Trash2, 
  Clock, 
  MessageSquare, 
  Send,
  Settings,
  Key,
  AlertCircle,
  Copy,
  Eye,
  EyeOff
} from 'lucide-react';
import {
  getGeoProvider,
  LocusError,
  type AnalysisMode,
  type ChatSession,
  type GeolocationResult,
  type GroundingTool,
} from './services/geo';
import {
  clearLocalData,
  DEFAULT_CONFIG,
  getConfig,
  MODEL_OPTIONS,
  saveConfig,
  type LocusConfig,
} from './services/config';
import { formatDecimalPair, formatLatitude, formatLongitude } from './lib/coords';
import { SearchEntryPointFrame } from './components/SearchEntryPointFrame';
import {
  isHistoryEnabled,
  loadHistory,
  MAX_HISTORY,
  mergeHistory,
  saveHistory,
  setHistoryEnabled,
  type HistoryItem,
} from './lib/historyStore';
import Markdown from 'react-markdown';

// Fix for Leaflet default marker icon
const DefaultIcon = L.icon({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;

function mimeTypeOf(dataUrl: string): string {
  const match = /^data:([^;,]+)[;,]/.exec(dataUrl);
  return match?.[1] ?? 'image/jpeg';
}

/** Errors the user can fix by switching to another key or project. */
function isKeyRelated(err: unknown): boolean {
  return err instanceof LocusError && (err.code === 'AUTH' || err.code === 'QUOTA' || err.code === 'MODEL_UNAVAILABLE');
}

/** Last four characters, enough to tell keys apart without exposing them. */
function keyHint(key: string): string {
  return key.length > 8 ? `…${key.slice(-4)}` : '';
}

function errorMessage(err: unknown): string {
  if (err instanceof LocusError) {
    const showDetail = (err.code === 'UNKNOWN' || err.code === 'PARSE') && err.detail;
    return showDetail ? `${err.message} (${err.detail!.slice(0, 300)})` : err.message;
  }
  return err instanceof Error ? err.message : 'Analysis failed. Please try again.';
}

// Helper to manage map controls (re-center & zoom)
function MapController({ center, zoom, target }: { center: [number, number]; zoom: number; target: [number, number] }) {
  const map = useMap();
  
  useEffect(() => {
    map.setView(center, zoom, { animate: true });
    
    // small delay to ensure container is fully sized
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 200);
    return () => clearTimeout(timer);
  }, [center, zoom, map]);

  useEffect(() => {
    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
    });
    resizeObserver.observe(map.getContainer());
    
    return () => {
      resizeObserver.disconnect();
    };
  }, [map]);

  return (
    <div className="absolute top-2 right-2 z-[1000] flex flex-row gap-1.5 items-center">
      <button 
        onClick={() => map.zoomIn()}
        className="p-1 bg-black/80 hover:bg-black border border-white/10 rounded backdrop-blur-md text-gray-400 hover:text-cyan-400 transition-all"
        title="Zoom In"
      >
        <Plus className="w-3 h-3" />
      </button>
      <button 
        onClick={() => map.zoomOut()}
        className="p-1 bg-black/80 hover:bg-black border border-white/10 rounded backdrop-blur-md text-gray-400 hover:text-cyan-400 transition-all"
        title="Zoom Out"
      >
        <Minus className="w-3 h-3" />
      </button>
      <div className="w-[1px] h-3 bg-white/10 mx-0.5" />
      <button 
        onClick={() => map.setView(target, 13, { animate: true })}
        className="p-1.5 bg-cyan-600 hover:bg-cyan-500 border border-cyan-400/30 rounded shadow-[0_0_10px_rgba(8,145,178,0.3)] transition-all group"
        title="Re-center on Target"
      >
        <Target className="w-3 h-3 text-white animate-pulse group-hover:scale-110 transition-transform" />
      </button>
    </div>
  );
}

export default function App() {
  const [image, setImage] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<GeolocationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorNeedsKey, setErrorNeedsKey] = useState(false);
  const [mapCenter, setMapCenter] = useState<[number, number]>([0, 0]);
  const [mapZoom, setMapZoom] = useState(13);
  const [tempMarker, setTempMarker] = useState<[number, number] | null>(null);
  
  const [chatSession, setChatSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<{ role: 'user' | 'model', text: string }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatting, setIsChatting] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyEnabled, setHistoryEnabledState] = useState(isHistoryEnabled);
  const currentImageRef = useRef<string | null>(null);
  currentImageRef.current = image;
  const [activeTab, setActiveTab] = useState<'analysis' | 'history'>('analysis');
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>('visual');
  const [groundingTool, setGroundingTool] = useState<GroundingTool>('maps');

  // Config Management
  const [config, setConfig] = useState<LocusConfig>(() => getConfig());
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState(config.apiKey);
  const [selectedModel, setSelectedModel] = useState(config.modelName);
  const [rememberKeyInput, setRememberKeyInput] = useState(config.rememberKey);
  const [showKey, setShowKey] = useState(false);

  const openSettings = () => {
    setApiKeyInput(config.apiKey);
    setSelectedModel(config.modelName);
    setRememberKeyInput(config.rememberKey);
    setShowKey(false);
    setIsSettingsOpen(true);
  };

  useEffect(() => {
    let cancelled = false;
    loadHistory().then((stored) => {
      if (cancelled) return;
      // Analyses finished before the store answered are kept.
      setHistory((prev) => mergeHistory(prev, stored));
      setHistoryLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Writing before the initial load would overwrite the stored history.
    if (historyLoaded) void saveHistory(history);
  }, [history, historyLoaded]);

  const toggleHistoryEnabled = (enabled: boolean) => {
    setHistoryEnabled(enabled);
    setHistoryEnabledState(enabled);
  };

  useEffect(() => {
    if (result?.coordinates) {
      setMapCenter([result.coordinates.lat, result.coordinates.lng]);
      setMapZoom(13);
      setTempMarker(null);
    }
  }, [result]);

  useEffect(() => {
    if (result && image && config.apiKey) {
      try {
        setChatSession(getGeoProvider().createChatSession({ base64Data: image.split(',')[1], mimeType: mimeTypeOf(image) }, result));
        setMessages([{ role: 'model', text: 'Ask about the image or the analysis. Answers are model output and need independent verification.' }]);
      } catch (e) {
        console.error('Chat session creation failed:', e);
        setError(errorMessage(e));
        setErrorNeedsKey(isKeyRelated(e));
      }
    } else {
      setChatSession(null);
      setMessages([]);
    }
  }, [result, image, config.apiKey]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async (e?: React.FormEvent, overrideText?: string) => {
    e?.preventDefault();
    const userText = (overrideText || chatInput).trim();
    if (!userText || !chatSession || isChatting) return;

    setChatInput('');
    setMessages(prev => [...prev, { role: 'user', text: userText }]);
    setIsChatting(true);

    try {
      const resp = await chatSession.sendMessage(userText);
      setMessages(prev => [...prev, { role: 'model', text: resp }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'model', text: `Error: ${errorMessage(err)}` }]);
    } finally {
      setIsChatting(false);
    }
  };

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const selectedFile = acceptedFiles[0];
    if (selectedFile) {
      setFile(selectedFile);
      const reader = new FileReader();
      reader.onload = (e) => {
        setImage(e.target?.result as string);
        setResult(null);
        setError(null);
        setActiveTab('analysis');
      };
      reader.readAsDataURL(selectedFile);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': ['.jpeg', '.jpg', '.png', '.webp'] },
    multiple: false
  } as any);

  const handleAnalyze = async () => {
    if (!config.apiKey) {
      openSettings();
      return;
    }
    if (!image) return;
    const requestImage = image;
    setIsAnalyzing(true);
    setError(null);
    try {
      const res = await getGeoProvider().analyzeImage({
        base64Data: image.split(',')[1],
        mimeType: file?.type || mimeTypeOf(image),
        mode: analysisMode,
        groundingTool,
      });
      // The user may have replaced or cleared the image while the request was running.
      if (currentImageRef.current !== requestImage) return;
      setResult(res);

      if (historyEnabled) {
        const newItem: HistoryItem = {
          id: crypto.randomUUID(),
          image: requestImage,
          result: res,
          timestamp: Date.now()
        };
        setHistory(prev => [newItem, ...prev].slice(0, MAX_HISTORY));
      }
    } catch (err) {
      if (currentImageRef.current === requestImage) {
        setError(errorMessage(err));
        setErrorNeedsKey(isKeyRelated(err));
      }
    } finally {
      setIsAnalyzing(false);
    }
  };

  const loadHistoryItem = (item: HistoryItem) => {
    setImage(item.image);
    setResult(item.result);
    setFile(null);
    setError(null);
    setActiveTab('analysis');
  };

  const deleteHistoryItem = (id: string, e: MouseEvent) => {
    e.stopPropagation();
    setHistory(prev => prev.filter(item => item.id !== id));
  };

  const reset = () => {
    setImage(null);
    setFile(null);
    setResult(null);
    setError(null);
    setTempMarker(null);
  };

  const getDistanceFromLatLonInKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371; // Radius of the earth in km
    const dLat = deg2rad(lat2-lat1);  
    const dLon = deg2rad(lon2-lon1); 
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * 
      Math.sin(dLon/2) * Math.sin(dLon/2)
      ; 
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
    const d = R * c; // Distance in km
    return d;
  };

  const deg2rad = (deg: number) => {
    return deg * (Math.PI/180);
  };

  const handleSourceClick = (source: { uri: string; type: string }, e: React.MouseEvent) => {
    if (source.type === 'maps' && result?.coordinates) {
      const url = source.uri;
      const coordMatch = url.match(/query=([-+]?\d*\.?\d+),([-+]?\d*\.?\d+)/) || 
                       url.match(/@([-+]?\d*\.?\d+),([-+]?\d*\.?\d+)(?:,(\d+)z)?/) ||
                       url.match(/ll=([-+]?\d*\.?\d+),([-+]?\d*\.?\d+)/);
      
      if (coordMatch) {
        const targetLat = parseFloat(coordMatch[1]);
        const targetLng = parseFloat(coordMatch[2]);
        const distKm = getDistanceFromLatLonInKm(targetLat, targetLng, result.coordinates.lat, result.coordinates.lng);
        
        // If within 50km vicinity, pan and zoom to it without opening new tab
        if (distKm < 50) {
          e.preventDefault();
          setMapCenter([targetLat, targetLng]);
          if (coordMatch[3]) {
            setMapZoom(parseInt(coordMatch[3]));
          } else {
            setMapZoom(16);
          }
          setTempMarker([targetLat, targetLng]);
        }
      }
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).catch((e) => console.error('Clipboard write failed', e));
  };

  return (
    <div className="h-screen bg-[#0a0a0a] text-gray-200 font-sans flex flex-col overflow-hidden selection:bg-cyan-900/40">
      {/* Header Bar */}
      <header className="h-16 border-b border-white/10 flex items-center justify-between px-6 bg-[#0f0f0f] shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold tracking-tight text-white uppercase flex items-baseline gap-2">
            LOCUS <span className="text-xs font-medium text-gray-500 uppercase tracking-widest">by</span>
          </h1>
          <a href="https://provereno.media/" target="_blank" rel="noopener noreferrer" className="hover:opacity-80 transition-opacity">
            <img 
              src={`${import.meta.env.BASE_URL}Provereno Logo.png`} 
              alt="Provereno Logo" 
              className="h-6 md:h-7 object-contain rounded-sm" 
            />
          </a>

          {/* Header Status Badge */}
          <div className="ml-4 hidden sm:block">
            {!config.apiKey ? (
              <button 
                onClick={openSettings}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-amber-500/10 border border-amber-500/30 text-[9px] font-mono font-bold text-amber-500 animate-pulse uppercase tracking-wider hover:bg-amber-500/20 transition-all"
              >
                <AlertCircle className="w-3 h-3" />
                <span>NO API KEY</span>
              </button>
            ) : (
              <button 
                onClick={openSettings}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-cyan-950/40 border border-cyan-500/30 text-[9px] font-mono font-bold text-cyan-400 uppercase tracking-wider hover:bg-cyan-500/10 transition-all"
              >
                <Key className="w-3 h-3 text-cyan-400" />
                <span>KEY {keyHint(config.apiKey) || 'SET'} · CHANGE</span>
              </button>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="relative hidden md:block">
            <History className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
            <div className="w-80 bg-white/5 border border-white/10 rounded-full py-1.5 px-9 text-[10px] text-gray-500 font-mono flex items-center gap-2">
              <span className="text-cyan-500 animate-pulse">●</span>
              LOCAL HISTORY: {history.length} SAVED IN THIS BROWSER{!historyEnabled && ' · SAVING OFF'}
            </div>
          </div>

          {/* Settings Button */}
          <button 
            onClick={openSettings}
            className="p-2 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-all"
            title="LOCUS Engine Configuration"
          >
            <Settings className="w-4 h-4" />
          </button>

          {/* Main Action Button */}
          {!config.apiKey ? (
            <button 
              onClick={openSettings}
              className="px-5 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wider transition-all border border-amber-500/50 text-amber-500 hover:bg-amber-500/10 flex items-center gap-1.5 shadow-[0_0_15px_rgba(245,158,11,0.1)] hover:shadow-[0_0_20px_rgba(245,158,11,0.2)] animate-pulse"
            >
              <Key className="w-3.5 h-3.5" />
              Configure API Key
            </button>
          ) : (
            <button 
              disabled={!image || isAnalyzing || !!result}
              onClick={handleAnalyze}
              className={`
                px-6 py-1.5 rounded-full text-sm font-medium transition-all
                ${image && !result && !isAnalyzing 
                  ? 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-[0_0_15px_rgba(8,145,178,0.3)]' 
                  : 'bg-white/5 text-gray-500 border border-white/10 cursor-not-allowed'}
              `}
            >
              {isAnalyzing ? 'Analyzing Frame...' : 'Identify Frame'}
            </button>
          )}
        </div>

        <div className="hidden lg:flex items-center gap-6 text-[10px] font-mono">
          <div className="flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${config.apiKey ? 'bg-cyan-500' : 'bg-amber-500'}`}></div>
            <span className={`${config.apiKey ? 'text-cyan-400' : 'text-amber-500'} uppercase tracking-widest`}>
              {config.apiKey ? 'Key: set' : 'Key: missing'}
            </span>
          </div>
          <div className="w-8 h-8 rounded-full bg-gray-900 border border-white/10 flex items-center justify-center overflow-hidden">
            <div className={`w-full h-full bg-gradient-to-tr ${config.apiKey ? 'from-cyan-900/40 to-blue-900/40' : 'from-amber-950/40 to-red-950/40'}`} />
          </div>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        {/* Sidebar: Status & Results */}
        <aside className="w-80 border-r border-white/10 bg-[#0f0f0f] flex flex-col shrink-0 overflow-hidden">
          {/* Tab Switcher */}
          <div className="flex border-b border-white/10 bg-black/40">
            <button 
              onClick={() => setActiveTab('analysis')}
              className={`flex-1 py-3 text-[10px] font-bold uppercase tracking-[0.2em] transition-all relative ${activeTab === 'analysis' ? 'text-cyan-400' : 'text-gray-600 hover:text-gray-400'}`}
            >
              Analysis
              {activeTab === 'analysis' && <motion.div layoutId="tab-underline" className="absolute bottom-0 left-0 right-0 h-0.5 bg-cyan-500" />}
            </button>
            <button 
              onClick={() => setActiveTab('history')}
              className={`flex-1 py-3 text-[10px] font-bold uppercase tracking-[0.2em] transition-all relative flex items-center justify-center gap-2 ${activeTab === 'history' ? 'text-cyan-400' : 'text-gray-600 hover:text-gray-400'}`}
            >
              History
              {history.length > 0 && <span className="bg-cyan-500/20 text-cyan-500 px-1 rounded text-[8px]">{history.length}</span>}
              {activeTab === 'history' && <motion.div layoutId="tab-underline" className="absolute bottom-0 left-0 right-0 h-0.5 bg-cyan-500" />}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar">
            <AnimatePresence mode="wait">
              {activeTab === 'analysis' ? (
                <motion.div 
                  key="analysis"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  className="p-6 space-y-8"
                >
                  {/* Probability / Confidence */}
                  <section>
                    <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-3 block">Model-Reported Confidence</label>
                    {result ? (
                      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                        <div className="flex items-end gap-2">
                          <span className="text-5xl font-light text-cyan-400">{(result.confidence * 100).toFixed(0)}<span className="text-2xl">%</span></span>
                          <span className="text-xs text-amber-500 mb-2 font-mono uppercase">{result.coordinates ? 'Hypothesis · verify manually' : 'Location not determined'}</span>
                        </div>
                        <div className="mt-3 h-1 w-full bg-white/5 rounded-full overflow-hidden">
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${result.confidence * 100}%` }}
                            className="h-full bg-cyan-500" 
                          />
                        </div>
                      </motion.div>
                    ) : (
                      <div className="space-y-3 opacity-20">
                        <div className="text-5xl font-light text-gray-700">00.0<span className="text-2xl">%</span></div>
                        <div className="h-1 w-full bg-white/5 rounded-full" />
                      </div>
                    )}
                  </section>

                  {/* Coordinates Section */}
                  <section className="space-y-4">
                    <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold block">Target Geo-Coordinates</label>
                    <div className="bg-white/5 border border-white/10 rounded-lg p-4 space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] text-gray-500 font-mono uppercase">Latitude</span>
                        <span className="font-mono text-sm text-cyan-400">
                          {result?.coordinates ? formatLatitude(result.coordinates.lat) : result ? 'Not determined' : '---.----'}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] text-gray-500 font-mono uppercase">Longitude</span>
                        <span className="font-mono text-sm text-cyan-400">
                          {result?.coordinates ? formatLongitude(result.coordinates.lng) : result ? 'Not determined' : '---.----'}
                        </span>
                      </div>
                      {result?.coordinates && (
                        <div className="flex gap-2 mt-2">
                          <button 
                            onClick={() => result.coordinates && window.open(`https://www.google.com/maps/search/?api=1&query=${result.coordinates.lat},${result.coordinates.lng}`, '_blank', 'noopener,noreferrer')}
                            className="flex-1 py-2 bg-white/5 border border-white/10 rounded text-[10px] text-gray-400 hover:bg-white/10 hover:text-white transition-all uppercase tracking-widest"
                          >
                            Earth View
                          </button>
                          <button 
                            onClick={() => result.coordinates && copyToClipboard(formatDecimalPair(result.coordinates))}
                            className="px-3 py-2 bg-white/5 border border-white/10 rounded text-[10px] text-gray-400 hover:bg-white/10 hover:text-white transition-all uppercase tracking-widest flex items-center justify-center"
                            title="Copy Coordinates"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  </section>

                  {/* Heuristic Summary */}
                  <section className="space-y-3">
                    <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold block">Heuristic Summary</label>
                    <div className="p-3 bg-white/5 border border-white/10 rounded-lg space-y-3">
                      <p className="text-xs text-gray-400 leading-relaxed italic">
                        {result ? result.description : 'Connect a visual source to begin geolocation heuristics analysis.'}
                      </p>
                      {result && !isChatOpen && (
                        <button 
                          onClick={() => setIsChatOpen(true)}
                          className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-cyan-600 hover:bg-cyan-500 rounded text-[10px] font-bold text-white tracking-widest transition-colors"
                        >
                          <MessageSquare className="w-3 h-3" /> OPEN ANALYSIS CHAT
                        </button>
                      )}
                    </div>
                  </section>

                  {/* Search queries: executed (from grounding metadata) vs. claimed by the model */}
                  {result && result.groundingQueries.length > 0 && (
                    <section className="space-y-3">
                      <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold block">Queries Executed by Google</label>
                      <div className="flex flex-wrap gap-2">
                        {result.groundingQueries.map((q, i) => (
                          <div key={i} className="px-2 py-1 bg-white/5 border border-white/10 rounded text-[10px] text-gray-300 font-mono flex items-center gap-1.5">
                            <Search className="w-3 h-3 text-cyan-500" />
                            {q}
                          </div>
                        ))}
                      </div>
                    </section>
                  )}
                  {result && result.modelReportedQueries.length > 0 && (
                    <section className="space-y-3">
                      <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold block">Queries Reported by Model (unverified)</label>
                      <div className="flex flex-wrap gap-2">
                        {result.modelReportedQueries.map((q, i) => (
                          <div key={i} className="px-2 py-1 bg-white/5 border border-white/10 rounded text-[10px] text-gray-500 font-mono">
                            {q}
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* Extracted Text */}
                  {result?.extractedText && result.extractedText.length > 0 && (
                    <section className="space-y-3">
                      <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold block">Extracted Text & OCR</label>
                      <div className="space-y-2">
                        {result.extractedText.map((text, i) => (
                          <div key={i} className="p-2 bg-black/40 border border-white/5 rounded text-xs text-gray-300 font-mono">
                            {text}
                          </div>
                        ))}
                      </div>
                    </section>
                  )}
                  
                  {/* Extracted Symbols */}
                  {result?.identifiedSymbols && result.identifiedSymbols.length > 0 && (
                    <section className="space-y-3">
                      <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold block">Identified Symbols</label>
                      <div className="space-y-2">
                        {result.identifiedSymbols.map((sym, i) => (
                          <div key={i} className="p-2 bg-white/5 border border-white/10 text-cyan-400 rounded text-xs">
                            {sym}
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* Grounding Widget */}
                  {result?.searchEntryPointHtml && (
                    <section className="space-y-3">
                      <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold block">Google Search Suggestions</label>
                      <div className="bg-white/5 border border-white/10 rounded-lg p-2 overflow-hidden">
                        <SearchEntryPointFrame html={result.searchEntryPointHtml} />
                      </div>
                    </section>
                  )}

                  {/* detail analysis */}
                  <section className="flex flex-col min-h-0">
                    <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-3 block">Detected Indicators</label>
                    <div className="space-y-2">
                      {result ? (
                        result.evidence.map((item, i) => (
                          <motion.div 
                            key={i}
                            initial={{ x: -10, opacity: 0 }}
                            animate={{ x: 0, opacity: 1 }}
                            transition={{ delay: i * 0.1 }}
                            className="flex items-center gap-3 p-2 rounded hover:bg-white/5 border border-transparent hover:border-white/5 transition-all group"
                          >
                            <div className="w-10 h-10 bg-gray-900 border border-white/10 rounded flex-shrink-0 flex items-center justify-center text-cyan-500/50 group-hover:text-cyan-500 transition-colors">
                              <MapPin className="w-4 h-4" />
                            </div>
                            <div>
                              <p className="text-xs font-semibold text-gray-200">{item}</p>
                              <p className="text-[10px] text-gray-600 font-mono uppercase tracking-tighter">Reported by model</p>
                            </div>
                          </motion.div>
                        ))
                      ) : (
                        [1, 2, 3].map(i => (
                          <div key={i} className="flex items-center gap-3 p-2 opacity-20">
                            <div className="w-10 h-10 bg-gray-900 border border-white/10 rounded flex-shrink-0" />
                            <div className="space-y-1.5 flex-1">
                              <div className="h-2 bg-gray-800 rounded w-3/4" />
                              <div className="h-1.5 bg-gray-800 rounded w-1/2" />
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </section>

                  {/* Verification Sources */}
                  {result?.sources && result.sources.length > 0 && (
                    <section className="space-y-3">
                      <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold block">Verification Sources</label>
                      <div className="space-y-2">
                        {result.sources.map((source, i) => (
                          <a 
                            key={i} 
                            href={source.uri} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            onClick={(e) => handleSourceClick(source, e)}
                            className={`flex items-center justify-between p-3 rounded bg-white/2 border transition-all cursor-pointer group ${source.type === 'maps' ? 'border-cyan-500/20 bg-cyan-950/10' : 'border-white/5 hover:border-cyan-500/40 hover:bg-cyan-500/5'}`}
                          >
                            <div className="flex items-center gap-2 truncate pr-4">
                              {source.type === 'maps' ? (
                                <MapIcon className="w-3 h-3 text-cyan-500 shrink-0" />
                              ) : (
                                <Globe className="w-3 h-3 text-gray-500 group-hover:text-cyan-500 shrink-0" />
                              )}
                              <span className={`text-[10px] font-medium truncate ${source.type === 'maps' ? 'text-cyan-400' : 'text-gray-400 group-hover:text-cyan-400'}`}>
                                {source.title}
                              </span>
                            </div>
                            <ExternalLink className={`w-3 h-3 shrink-0 ${source.type === 'maps' ? 'text-cyan-600' : 'text-gray-600 group-hover:text-cyan-600'}`} />
                          </a>
                        ))}
                      </div>
                    </section>
                  )}
                </motion.div>
              ) : (
                <motion.div 
                  key="history"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  className="p-4 space-y-4"
                >
                  <div className="flex items-center justify-between px-2">
                    <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">Local History (not encrypted)</label>
                    {history.length > 0 && (
                      <button 
                        onClick={() => { if(confirm('Purge all archived records?')) setHistory([]) }}
                        className="text-[8px] text-gray-700 hover:text-red-400 flex items-center gap-1 font-mono uppercase tracking-widest transition-colors"
                      >
                        <Trash2 className="w-3 h-3" /> Purge
                      </button>
                    )}
                  </div>
                  <div className="px-2 space-y-2 text-[10px] font-mono text-gray-500 leading-relaxed">
                    <p>Analyses and images are stored only in this browser (IndexedDB), without encryption. Anyone with access to this browser profile can open them.</p>
                    <label className="flex items-center gap-2 text-gray-400 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={historyEnabled}
                        onChange={e => toggleHistoryEnabled(e.target.checked)}
                        className="accent-cyan-500"
                      />
                      Save new analyses to history
                    </label>
                  </div>
                  
                  {history.length === 0 ? (
                    <div className="py-20 text-center space-y-3 opacity-20">
                      <Clock className="w-8 h-8 mx-auto" />
                      <p className="text-[10px] font-mono uppercase tracking-widest">No spectral traces found</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {history.map((item) => (
                        <div 
                          key={item.id}
                          onClick={() => loadHistoryItem(item)}
                          className="p-3 bg-white/2 border border-white/5 rounded-lg hover:border-cyan-500/40 hover:bg-cyan-900/10 transition-all cursor-pointer group flex gap-3 items-center"
                        >
                          <div className="w-12 h-12 rounded border border-white/10 overflow-hidden shrink-0 bg-gray-900">
                            <img src={item.image} alt="" className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <h4 className="text-[11px] font-bold text-gray-300 truncate tracking-tight">{item.result.locationName}</h4>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-[9px] text-cyan-600 font-mono">{item.result.coordinates ? `${(item.result.confidence * 100).toFixed(0)}% (model)` : 'NOT DETERMINED'}</span>
                              <span className="text-[9px] text-gray-600 font-mono">{new Date(item.timestamp).toLocaleDateString()}</span>
                            </div>
                          </div>
                          <button 
                            onClick={(e) => deleteHistoryItem(item.id, e)}
                            className="p-1.5 text-gray-800 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="mt-auto p-4 border-t border-white/5 bg-black/20">
            <div className="text-[10px] text-gray-600 font-mono uppercase leading-relaxed">
              MODEL: {result?.model ?? config.modelName}<br/>
              STATUS: {isAnalyzing ? 'ANALYZING' : 'IDLE'}
              {result?.modelFallbackFrom && (<><br/><span className="text-amber-600">{result.modelFallbackFrom} unavailable, used {result.model}</span></>)}
            </div>
          </div>
        </aside>

        {/* Main View Port */}
        <section className="flex-1 relative bg-[#050505] flex flex-col overflow-hidden">
          {/* Map & Context Overlay Bar */}
          <div className="p-4 shrink-0 z-20">
            <div className="bg-black/60 backdrop-blur-xl border border-white/10 rounded-xl flex flex-col md:flex-row items-stretch overflow-hidden">
               {/* Map Preview */}
               <div className="w-40 h-40 shrink-0 bg-gray-950 border-r border-white/10 relative overflow-hidden group">
                  {result?.coordinates ? (
                    <MapContainer 
                      center={mapCenter} 
                      zoom={mapZoom} 
                      zoomControl={false}
                      attributionControl={false}
                      className="h-full w-full"
                      style={{ height: "100%", width: "100%" }}
                    >
                      <TileLayer 
                        url={analysisMode === 'satellite' 
                          ? "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" 
                          : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                        } 
                      />
                      <Marker position={[result.coordinates.lat, result.coordinates.lng]} />
                      {tempMarker && <Marker position={tempMarker} opacity={0.5} />}
                      <MapController center={mapCenter} zoom={mapZoom} target={[result.coordinates.lat, result.coordinates.lng]} />
                    </MapContainer>
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center opacity-10 bg-[radial-gradient(#ffffff10_1px,transparent_1px)] bg-[size:16px_16px]">
                      <Compass className="w-10 h-10" />
                    </div>
                  )}
                  <div className="absolute bottom-1 left-1 px-1.5 py-0.5 bg-black/80 rounded text-[7px] font-mono text-gray-400 z-[1000]">
                    {analysisMode === 'satellite' ? (
                      <a href="https://www.esri.com/" target="_blank" rel="noopener noreferrer">Tiles © Esri</a>
                    ) : (
                      <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap</a>
                    )}
                  </div>
               </div>

               {/* Data Visualization */}
               <div className="flex-1 p-4 flex flex-wrap gap-6 items-center bg-gradient-to-r from-transparent to-white/5">
                  <div className="space-y-1">
                     <span className="text-[9px] text-gray-500 uppercase font-bold tracking-widest block">System Context</span>
                     <span className="text-lg font-light text-white block">
                       {result ? result.locationName : 'Awaiting Frame'}
                     </span>
                  </div>

                  <div className="hidden lg:block w-[1px] h-6 bg-white/10" />

                  <div className="space-y-1">
                     <span className="text-[9px] text-gray-500 uppercase font-bold tracking-widest block">Analysis Mode</span>
                     <div className="flex gap-1.5">
                        <button 
                         onClick={() => setAnalysisMode('visual')}
                         disabled={isAnalyzing}
                         className={`px-2 py-0.5 rounded text-[9px] font-bold border transition-all ${analysisMode === 'visual' ? 'bg-cyan-600/20 border-cyan-500/40 text-cyan-400' : 'bg-white/5 border-white/10 text-gray-700 hover:text-gray-400'}`}
                        >
                          VISUAL
                        </button>
                        <button 
                         onClick={() => setAnalysisMode('satellite')}
                         disabled={isAnalyzing}
                         className={`px-2 py-0.5 rounded text-[9px] font-bold border transition-all ${analysisMode === 'satellite' ? 'bg-cyan-600/20 border-cyan-500/40 text-cyan-400' : 'bg-white/5 border-white/10 text-gray-700 hover:text-gray-400'}`}
                        >
                          SATELLITE
                        </button>
                        <button 
                         onClick={() => setAnalysisMode('flora')}
                         disabled={isAnalyzing}
                         className={`px-2 py-0.5 rounded text-[9px] font-bold border transition-all ${analysisMode === 'flora' ? 'bg-cyan-600/20 border-cyan-500/40 text-cyan-400' : 'bg-white/5 border-white/10 text-gray-700 hover:text-gray-400'}`}
                        >
                          FLORA
                        </button>
                     </div>
                  </div>

                  <div className="hidden lg:block w-[1px] h-6 bg-white/10" />

                  <div className="space-y-1">
                     <span className="text-[9px] text-gray-500 uppercase font-bold tracking-widest block">Grounding</span>
                     <div className="flex gap-1.5">
                        <button 
                         onClick={() => setGroundingTool('search')}
                         disabled={isAnalyzing}
                         className={`px-2 py-0.5 rounded text-[9px] font-bold border transition-all ${groundingTool === 'search' ? 'bg-cyan-600/20 border-cyan-500/40 text-cyan-400' : 'bg-white/5 border-white/10 text-gray-700 hover:text-gray-400'}`}
                        >
                          WEB SEARCH
                        </button>
                        <button 
                         onClick={() => setGroundingTool('maps')}
                         disabled={isAnalyzing}
                         className={`px-2 py-0.5 rounded text-[9px] font-bold border transition-all ${groundingTool === 'maps' ? 'bg-cyan-600/20 border-cyan-500/40 text-cyan-400' : 'bg-white/5 border-white/10 text-gray-700 hover:text-gray-400'}`}
                        >
                          GOOGLE MAPS
                        </button>
                     </div>
                  </div>

               </div>
            </div>
          </div>

          {/* Main Display Area */}
          <div className="flex-1 relative flex items-center justify-center p-8 overflow-auto custom-scrollbar">
            {!image ? (
              !config.apiKey ? (
                /* LOCKED Dropzone Empty State */
                <div className="w-full max-w-2xl h-[400px] border-2 border-dashed border-amber-500/30 rounded-lg bg-amber-500/5 flex flex-col items-center justify-center text-center gap-4 relative overflow-hidden group p-6">
                  <div className="absolute inset-0 bg-[#000]/30 backdrop-blur-[2px] flex flex-col items-center justify-center gap-4 z-10 p-6">
                    <div className="w-14 h-14 rounded-full border border-amber-500/30 bg-amber-500/10 flex items-center justify-center text-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.2)]">
                      <Key className="w-6 h-6 animate-pulse" />
                    </div>
                    <div className="space-y-2">
                      <p className="text-base font-bold tracking-wider text-amber-500 uppercase">SYSTEM LOCKED: GEMINI API KEY REQUIRED</p>
                      <p className="text-xs text-gray-400 font-mono max-w-md mx-auto leading-relaxed">
                        LOCUS visual engine requires a secure direct connection to Google Gemini. Please configure your API key to enable visual analysis and geographic heuristics.
                      </p>
                    </div>
                    <button 
                      onClick={openSettings}
                      className="mt-2 px-5 py-2 rounded bg-amber-500 hover:bg-amber-400 text-[#0a0a0a] font-mono text-xs font-bold tracking-widest uppercase transition-all shadow-[0_0_15px_rgba(245,158,11,0.3)] hover:scale-105"
                    >
                      Configure Engine Key
                    </button>
                  </div>
                </div>
              ) : (
                /* Active Dropzone empty state */
                <div 
                  {...getRootProps()} 
                  className={`
                    w-full max-w-2xl h-[400px] border-2 border-dashed rounded-lg transition-all 
                    flex flex-col items-center justify-center text-center gap-4 cursor-pointer
                    ${isDragActive ? 'border-cyan-500 bg-cyan-500/5 scale-105' : 'border-white/5 hover:border-white/20 bg-white/2'}
                  `}
                >
                  <input {...getInputProps()} />
                  <div className="w-16 h-16 rounded-full border border-white/10 flex items-center justify-center text-gray-700 animate-pulse">
                    <Upload className="w-6 h-6" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-base font-semibold tracking-tight uppercase">INSERT TARGET FRAME</p>
                    <p className="text-[10px] text-gray-600 font-mono uppercase">Drag/Drop imagery or tap to select</p>
                  </div>
                </div>
              )
            ) : (
              <div className="relative flex flex-col items-center">
                <div className={`relative group transition-transform ${isAnalyzing ? 'scale-105' : ''}`}>
                  <img 
                    src={image} 
                    alt="Target" 
                    className={`max-w-full max-h-[60vh] rounded-sm shadow-2xl transition-all border border-white/20 ${isAnalyzing ? 'opacity-40 grayscale blur-[2px]' : 'opacity-90'}`} 
                  />
                  
                  {/* Scanning Overlay */}
                  <AnimatePresence>
                    {isAnalyzing && (
                      <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 scanline-effect pointer-events-none"
                      >
                         <motion.div 
                           animate={{ top: ['0%', '100%', '0%'] }}
                           transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
                           className="absolute left-0 right-0 h-[2px] bg-cyan-500 shadow-[0_0_20px_rgb(6,182,212)] z-10"
                         />
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Corner Guards */}
                  <div className="absolute -top-4 -left-4 w-12 h-12 border-t-2 border-l-2 border-cyan-500/40"></div>
                  <div className="absolute -bottom-4 -right-4 w-12 h-12 border-b-2 border-r-2 border-cyan-500/40"></div>

                  <button 
                    onClick={reset}
                    className="absolute -top-6 -right-6 bg-white/10 hover:bg-red-500/20 p-2 rounded-full text-white/50 hover:text-white transition-all backdrop-blur-md"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {error && (
                  <motion.div 
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    className="mt-6 px-4 py-2 bg-red-950/40 border border-red-500/40 rounded text-xs text-red-400 font-mono max-w-lg"
                  >
                    SYS_ERR: {error}
                    {errorNeedsKey && (
                      <button
                        type="button"
                        onClick={openSettings}
                        className="mt-2 flex items-center gap-1.5 text-cyan-400 hover:text-cyan-300 hover:underline"
                      >
                        <Key className="w-3 h-3" /> Change API key{config.apiKey && ` (current ${keyHint(config.apiKey)})`}
                      </button>
                    )}
                  </motion.div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Chat Sidebar */}
        {result && isChatOpen && (
          <aside className="w-[420px] border-l border-cyan-500/20 bg-[#050505] flex flex-col shrink-0 overflow-hidden z-20 relative">
            {/* Header */}
            <div className="h-[52px] border-b border-cyan-500/20 bg-cyan-950/20 flex items-center justify-between px-4 shrink-0 relative overflow-hidden">
               <div className="absolute top-0 left-0 w-full h-[1px] bg-cyan-500/30"></div>
               <div className="flex items-center gap-3 relative z-10">
                 <div className="relative flex items-center justify-center w-5 h-5 border border-cyan-500/40 bg-cyan-950 rounded bg-opacity-50">
                   <div className="w-1.5 h-1.5 rounded bg-cyan-400 animate-pulse shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
                 </div>
                 <div className="flex flex-col">
                   <span className="text-[10px] font-mono font-bold text-cyan-400 uppercase tracking-widest leading-none mb-1">
                     LOCUS Chat
                   </span>
                   <span className="text-[8px] font-mono text-cyan-600 uppercase tracking-widest leading-none">
                     Direct to Gemini API with your key
                   </span>
                 </div>
               </div>
               <button onClick={() => setIsChatOpen(false)} className="text-gray-500 hover:text-cyan-400 transition-colors bg-white/5 hover:bg-cyan-500/10 p-1.5 rounded relative z-10">
                 <X className="w-4 h-4" />
               </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-5 custom-scrollbar bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-cyan-950/5 via-[#050505] to-[#050505]">
              <div className="text-center pb-4 border-b border-white/5 mb-4">
                <span className="inline-block px-2 py-1 bg-white/5 rounded text-[9px] font-mono text-gray-500 uppercase tracking-widest">
                  -- Session Initiated --
                </span>
              </div>
              
              {messages.map((msg, idx) => (
                <div key={idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div className="flex items-center gap-2 mb-1.5 px-1">
                    {msg.role === 'model' && (
                      <span className="w-4 h-4 rounded bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center">
                        <MessageSquare className="w-2.5 h-2.5 text-cyan-400" />
                      </span>
                    )}
                    <span className={`text-[9px] font-mono uppercase tracking-widest ${msg.role === 'user' ? 'text-gray-400' : 'text-cyan-500'}`}>
                      {msg.role === 'user' ? 'Operator' : 'LOCUS'}
                    </span>
                    {msg.role === 'user' && (
                      <span className="w-4 h-4 rounded bg-white/10 border border-white/20 flex items-center justify-center">
                        <Target className="w-2.5 h-2.5 text-gray-400" />
                      </span>
                    )}
                  </div>
                  
                  <div className={`max-w-[92%] rounded-sm p-3.5 text-sm flex flex-col gap-1 border border-l-2 ${msg.role === 'user' ? 'bg-[#111] border-white/10 border-l-gray-600 text-gray-200' : 'bg-cyan-950/10 border-cyan-900/40 border-l-cyan-500 text-cyan-50'}`}>
                    {msg.role === 'model' ? (
                       <div className="markdown-body text-xs prose prose-invert prose-p:leading-relaxed prose-headings:text-cyan-400 prose-a:text-cyan-400 prose-strong:text-cyan-100 max-w-none">
                          <Markdown>{msg.text}</Markdown>
                       </div>
                    ) : (
                       <p className="text-xs font-mono">{msg.text}</p>
                    )}
                  </div>
                </div>
              ))}
              
              {isChatting && (
                <div className="flex flex-col items-start">
                  <div className="flex items-center gap-2 mb-1 px-1">
                    <span className="w-4 h-4 rounded bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center">
                      <MessageSquare className="w-2.5 h-2.5 text-cyan-400" />
                    </span>
                    <span className="text-[9px] font-mono uppercase tracking-widest text-cyan-600">LOCUS Analyzing...</span>
                  </div>
                  <div className="bg-cyan-950/5 border border-cyan-900/30 border-l-2 border-l-cyan-600 rounded-sm p-3.5 flex items-center gap-3">
                    <Loader2 className="w-4 h-4 text-cyan-500 hover:text-cyan-400 animate-spin" />
                    <span className="text-xs font-mono text-cyan-600 animate-pulse">Waiting for Gemini…</span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="p-4 bg-[#080808] border-t border-cyan-500/20 shrink-0 shadow-[0_-10px_20px_rgba(0,0,0,0.5)] flex flex-col gap-3">
              <div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar-thin snap-x">
                {[
                  "Analyze the architectural style",
                  "Identify environmental clues",
                  "Look for text and signage",
                  "Examine vehicles/infrastructure"
                ].map((query, i) => (
                  <button
                    key={i}
                    onClick={() => handleSendMessage(undefined, query)}
                    disabled={isChatting}
                    className="whitespace-nowrap px-2.5 py-1.5 rounded-sm bg-cyan-950/20 hover:bg-cyan-900/40 border border-cyan-500/20 text-cyan-500 hover:text-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed text-[10px] font-mono transition-colors snap-start flex-shrink-0"
                  >
                    + {query}
                  </button>
                ))}
              </div>
              <form onSubmit={handleSendMessage} className="relative flex items-center">
                 <div className="absolute left-3 text-cyan-600 pointer-events-none">
                   <ChevronRight className="w-4 h-4" />
                 </div>
                 <input 
                   type="text" 
                   value={chatInput}
                   onChange={e => setChatInput(e.target.value)}
                   placeholder="Enter query parameters..."
                   className="w-full bg-[#111] border border-white/10 focus:border-cyan-500/50 rounded-sm overflow-hidden pl-9 pr-12 py-3 text-xs font-mono text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-cyan-500/50 transition-all shadow-inner"
                 />
                 <button 
                   type="submit"
                   disabled={isChatting || !chatInput.trim()}
                   className="absolute right-2 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-500 disabled:text-gray-600 disabled:bg-transparent disabled:cursor-not-allowed p-1.5 rounded items-center justify-center flex transition-colors"
                 >
                   <Send className="w-3.5 h-3.5" />
                 </button>
              </form>
              <div className="mt-2 text-[8px] font-mono text-gray-600 text-center uppercase tracking-widest">
                 Model: {result.model} · answers need independent verification
              </div>
            </div>
          </aside>
        )}
      </main>

      {/* Settings Dialog Overlay */}
      <AnimatePresence>
        {isSettingsOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-md z-[9999] flex items-center justify-center p-4"
            onClick={() => setIsSettingsOpen(false)}
          >
            <motion.div 
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 10 }}
              className="w-full max-w-md max-h-[calc(100dvh-2rem)] bg-[#0a0a0a] border border-cyan-500/30 rounded-xl overflow-hidden shadow-[0_0_50px_rgba(8,145,178,0.25)] flex flex-col"
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="px-6 py-4 border-b border-white/10 flex justify-between items-center bg-[#0f0f0f]">
                <div className="flex items-center gap-2 text-cyan-400">
                  <Settings className="w-4 h-4 animate-pulse" />
                  <span className="text-xs font-mono font-bold uppercase tracking-wider">LOCUS Engine Settings</span>
                </div>
                <button 
                  onClick={() => setIsSettingsOpen(false)}
                  className="p-1.5 rounded bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Body */}
              <div className="p-6 space-y-6 overflow-y-auto min-h-0">
                <div className="p-3.5 bg-cyan-950/20 border border-cyan-500/20 rounded-lg space-y-2 text-xs leading-relaxed text-gray-400 font-mono">
                  <div className="flex items-center gap-2 text-cyan-400 font-bold">
                    <Info className="w-4 h-4 shrink-0" />
                    <span>YOUR OWN GEMINI KEY (BYOK)</span>
                  </div>
                  <p>
                    LOCUS runs in your browser. Images and your key go directly to Google's Gemini API; Provereno servers never receive them.
                  </p>
                  <p>
                    The key is stored in this browser without encryption: in local storage if "Remember key" is on, otherwise only in this tab until it is closed. Anyone with access to this browser profile can read it.
                  </p>
                  <p>
                    Restrict the key in Google Cloud Console → Credentials: under API restrictions allow only the Generative Language API; under Application restrictions choose Websites and add the LOCUS domain.
                  </p>
                  <p className="text-amber-500/90">
                    On Google's free tier, submitted images may be used to improve Google products and may be seen by human reviewers. Do not upload sensitive or unpublished material with a free-tier key.
                  </p>
                  <a 
                    href="https://aistudio.google.com/app/apikey" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-cyan-400 hover:text-cyan-300 hover:underline pt-1 font-bold"
                  >
                    Get an API key in Google AI Studio <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>

                {/* Inputs */}
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-mono font-bold uppercase tracking-widest text-gray-500 block">
                      Gemini API Key
                    </label>
                    <div className="relative flex items-center">
                      <Key className="absolute left-3 w-4 h-4 text-cyan-600 pointer-events-none" />
                      <input 
                        type={showKey ? 'text' : 'password'}
                        value={apiKeyInput}
                        onChange={e => setApiKeyInput(e.target.value)}
                        placeholder="AIzaSy..."
                        autoComplete="off"
                        spellCheck={false}
                        className="w-full bg-[#111] border border-white/10 focus:border-cyan-500/50 rounded pl-10 pr-16 py-2.5 text-xs font-mono text-white placeholder-gray-700 focus:outline-none transition-all"
                      />
                      <div className="absolute right-2 flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setShowKey(v => !v)}
                          className="p-1 text-gray-500 hover:text-cyan-400"
                          title={showKey ? 'Hide key' : 'Show key'}
                        >
                          {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                        {apiKeyInput && (
                          <button
                            type="button"
                            onClick={() => setApiKeyInput('')}
                            className="p-1 text-gray-500 hover:text-red-400"
                            title="Clear field to paste another key"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                    {config.apiKey && (
                      <p className="text-[10px] font-mono text-gray-600">
                        Active key: {keyHint(config.apiKey) || 'set'}. To switch keys, clear the field, paste the new key and save.
                      </p>
                    )}
                    <label className="flex items-start gap-2 pt-1 text-[11px] font-mono text-gray-400 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={rememberKeyInput}
                        onChange={e => setRememberKeyInput(e.target.checked)}
                        className="mt-0.5 accent-cyan-500"
                      />
                      <span>
                        Remember key on this device
                        <span className="block text-gray-600">Off: you re-enter the key in each new tab; it is erased when the tab is closed.</span>
                      </span>
                    </label>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-mono font-bold uppercase tracking-widest text-gray-500 block">
                      Active Model
                    </label>
                    <select 
                      value={selectedModel}
                      onChange={e => setSelectedModel(e.target.value)}
                      className="w-full bg-[#111] border border-white/10 focus:border-cyan-500/50 rounded px-3 py-2.5 text-xs font-mono text-gray-300 focus:outline-none transition-all"
                    >
                      {MODEL_OPTIONS.map((m) => (
                        <option key={m.id} value={m.id}>{m.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Footer Actions */}
              <div className="px-6 py-4 border-t border-white/10 flex justify-between bg-[#080808]">
                <button 
                  type="button"
                  onClick={() => {
                    if (confirm("Delete the saved API key, settings and analysis history from this browser?")) {
                      clearLocalData();
                      setConfig(DEFAULT_CONFIG);
                      setHistory([]);
                      setApiKeyInput('');
                      setSelectedModel(DEFAULT_CONFIG.modelName);
                      setRememberKeyInput(DEFAULT_CONFIG.rememberKey);
                      setIsSettingsOpen(false);
                    }
                  }}
                  className="px-3 py-2 border border-red-950 bg-red-950/20 hover:bg-red-900/20 hover:border-red-500/30 text-red-400 rounded text-[10px] font-mono uppercase tracking-wider transition-all"
                >
                  Clear Local Data
                </button>
                <div className="flex gap-2">
                  <button 
                    type="button"
                    onClick={() => setIsSettingsOpen(false)}
                    className="px-4 py-2 border border-white/10 hover:bg-white/5 rounded text-[10px] font-mono uppercase tracking-wider text-gray-400 hover:text-white transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    type="button"
                    onClick={() => {
                      const trimmedKey = apiKeyInput.trim();
                      const savedConfig = { apiKey: trimmedKey, modelName: selectedModel, rememberKey: rememberKeyInput };
                      if (!saveConfig(savedConfig)) {
                        alert('Could not save settings: browser storage is unavailable.');
                        return;
                      }
                      if (savedConfig.apiKey !== config.apiKey) {
                        setError(null);
                        setErrorNeedsKey(false);
                      }
                      setConfig(savedConfig);
                      setIsSettingsOpen(false);
                    }}
                    className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white border border-cyan-400/30 rounded text-[10px] font-mono uppercase tracking-wider font-bold transition-all shadow-[0_0_15px_rgba(8,145,178,0.2)]"
                  >
                    Save Configuration
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer Status Bar */}
      <footer className="h-10 bg-[#0f0f0f] border-t border-white/10 px-6 flex items-center justify-between shrink-0">
        <div className="flex gap-6 text-[10px] font-mono text-gray-600 uppercase tracking-tight">
          <span>VERSION 0.4</span>
        </div>
        <div className="text-[10px] text-gray-600 font-mono uppercase tracking-[0.2em] hidden sm:block">
          Vibecoded by Pavel "Pogoda" Bannikov for Provereno.Media
        </div>
      </footer>
    </div>
  );
}
