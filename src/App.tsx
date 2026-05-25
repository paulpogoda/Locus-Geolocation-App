import { useState, useCallback, useEffect, MouseEvent, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { motion, AnimatePresence } from 'motion/react';
import { MapPin, Upload, Loader2, Info, ChevronRight, X, Compass, Search, ExternalLink, Globe, Map as MapIcon, Target, Plus, Minus, History, Trash2, Clock, MessageSquare, Send, ShieldCheck, ShieldAlert, ShieldOff } from 'lucide-react';
import { geolocateImage, GeolocationResult, AnalysisMode, createOsintChatSession, ChatSession } from './services/geminiService';
import { formatC2paContextForChat, getC2paChipLabel, normalizeC2paScanResult, type C2paScanResult } from './services/c2paTypes';
import C2paCredentialsPanel, { C2paImageBadge } from './components/C2paCredentialsPanel';
import Markdown from 'react-markdown';

interface HistoryItem {
  id: string;
  image: string;
  result: GeolocationResult;
  c2pa?: C2paScanResult;
  timestamp: number;
}

function C2paHistoryIcon({ c2pa }: { c2pa?: C2paScanResult }) {
  if (!c2pa || c2pa.status === 'absent' || c2pa.status === 'disabled') {
    return <ShieldOff className="w-3 h-3 text-gray-700 shrink-0" />;
  }
  if (c2pa.status === 'present_valid_ai_claimed' || c2pa.status === 'present_unverified') {
    return <ShieldAlert className="w-3 h-3 text-amber-500 shrink-0" />;
  }
  if (c2pa.status === 'present_valid') {
    return <ShieldCheck className="w-3 h-3 text-cyan-500 shrink-0" />;
  }
  return <ShieldAlert className="w-3 h-3 text-red-500/80 shrink-0" />;
}

// Fix for Leaflet default marker icon
const DefaultIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;

// Helper to manage map controls (re-center & zoom)
function MapController({ center }: { center: [number, number] }) {
  const map = useMap();
  
  // Auto-center when 'center' prop changes (new result)
  useEffect(() => {
    map.setView(center, 13, { animate: true });
    
    // small delay to ensure container is fully sized
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 200);
    return () => clearTimeout(timer);
  }, [center, map]);

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
        onClick={() => map.setView(center, 13, { animate: true })}
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
  const [mapCenter, setMapCenter] = useState<[number, number]>([0, 0]);
  const [mapZoom, setMapZoom] = useState(13);
  const [tempMarker, setTempMarker] = useState<[number, number] | null>(null);
  
  const [chatSession, setChatSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<{ role: 'user' | 'model', text: string }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatting, setIsChatting] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  
  const [history, setHistory] = useState<HistoryItem[]>(() => {
    const saved = localStorage.getItem('osint_history');
    return saved ? JSON.parse(saved) : [];
  });
  const [activeTab, setActiveTab] = useState<'analysis' | 'history'>('analysis');
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>('visual');
  const [groundingTool, setGroundingTool] = useState<'search' | 'maps'>('maps');
  const [c2paResult, setC2paResult] = useState<C2paScanResult | null>(null);
  const [c2paScanning, setC2paScanning] = useState(false);
  const c2paScanGeneration = useRef(0);

  useEffect(() => {
    localStorage.setItem('osint_history', JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    if (result && image) {
      setMapCenter([result.coordinates.lat, result.coordinates.lng]);
      setMapZoom(13);
      
      const base64 = image.split(',')[1];
      let mimeType = 'image/jpeg';
      if (image.startsWith('data:image/png')) mimeType = 'image/png';
      else if (image.startsWith('data:image/webp')) mimeType = 'image/webp';
      
      setChatSession(
        createOsintChatSession(base64, mimeType, result, formatC2paContextForChat(c2paResult))
      );
      setMessages([{ role: 'model', text: 'LOCUS OSINT Agent online. Ready to answer questions regarding this visual analysis.' }]);
    } else {
      setChatSession(null);
      setMessages([]);
    }
  }, [result, image, c2paResult]);

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
      setMessages(prev => [...prev, { role: 'model', text: 'SYS_ERR: Unable to process query.' }]);
    } finally {
      setIsChatting(false);
    }
  };

  const runC2paScan = useCallback(async (selectedFile: File) => {
    const generation = ++c2paScanGeneration.current;
    setC2paScanning(true);
    setC2paResult(null);

    try {
      const { scanImageForC2pa } = await import('./services/c2paService');
      const scan = await scanImageForC2pa(selectedFile);
      if (generation === c2paScanGeneration.current) {
        setC2paResult(normalizeC2paScanResult(scan));
      }
    } catch (err) {
      console.error("C2PA scan failed:", err);
      if (generation === c2paScanGeneration.current) {
        setC2paResult(
          normalizeC2paScanResult({
            status: "error",
            summary: "C2PA scan failed unexpectedly.",
            errorMessage: err instanceof Error ? err.message : "Unknown error",
            softwareAgents: [],
            actions: [],
            digitalSourceTypes: [],
            validationIssues: [],
            scannedAt: Date.now(),
          })
        );
      }
    } finally {
      if (generation === c2paScanGeneration.current) {
        setC2paScanning(false);
      }
    }
  }, []);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const selectedFile = acceptedFiles[0];
    if (selectedFile) {
      setFile(selectedFile);
      void runC2paScan(selectedFile);
      const reader = new FileReader();
      reader.onload = (e) => {
        setImage(e.target?.result as string);
        setResult(null);
        setError(null);
        setActiveTab('analysis');
      };
      reader.readAsDataURL(selectedFile);
    }
  }, [runC2paScan]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': ['.jpeg', '.jpg', '.png', '.webp'] },
    multiple: false
  } as any);

  const handleAnalyze = async () => {
    if (!image || !file) return;
    setIsAnalyzing(true);
    setError(null);
    try {
      const base64Data = image.split(',')[1];
      const res = await geolocateImage(base64Data, file.type, analysisMode, groundingTool);
      setResult(res);

      // Add to history
      const newItem: HistoryItem = {
        id: crypto.randomUUID(),
        image,
        result: res,
        c2pa: c2paResult ?? undefined,
        timestamp: Date.now()
      };
      setHistory(prev => [newItem, ...prev].slice(0, 20)); // Keep last 20
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed. Please try again.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const loadHistoryItem = (item: HistoryItem) => {
    setImage(item.image);
    setResult(item.result);
    setC2paResult(normalizeC2paScanResult(item.c2pa));
    setC2paScanning(false);
    setFile(null); // File object can't be restored from localstorage easily
    setError(null);
    setActiveTab('analysis');
  };

  const deleteHistoryItem = (id: string, e: MouseEvent) => {
    e.stopPropagation();
    setHistory(prev => prev.filter(item => item.id !== id));
  };

  const reset = () => {
    c2paScanGeneration.current += 1;
    setImage(null);
    setFile(null);
    setResult(null);
    setC2paResult(null);
    setC2paScanning(false);
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
    if (source.type === 'maps' && result) {
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
    navigator.clipboard.writeText(text);
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
              src="/Provereno Logo.png" 
              alt="Provereno Logo" 
              className="h-6 md:h-7 object-contain rounded-sm" 
            />
          </a>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="relative hidden md:block">
            <History className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
            <div className="w-80 bg-white/5 border border-white/10 rounded-full py-1.5 px-9 text-[10px] text-gray-500 font-mono flex items-center gap-2">
              <span className="text-cyan-500 animate-pulse">●</span>
              ARCHIVE_READY: {history.length} OBJECTS STORED
            </div>
          </div>
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
        </div>

        <div className="hidden lg:flex items-center gap-6 text-[10px] font-mono">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 bg-cyan-500 rounded-full animate-pulse"></div>
            <span className="text-cyan-400 uppercase tracking-widest">Network: Live</span>
          </div>
          <div className="w-8 h-8 rounded-full bg-gray-900 border border-white/10 flex items-center justify-center overflow-hidden">
            <div className="w-full h-full bg-gradient-to-tr from-cyan-900/40 to-blue-900/40" />
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
                    <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-3 block">Probability Score</label>
                    {result ? (
                      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                        <div className="flex items-end gap-2">
                          <span className="text-5xl font-light text-cyan-400">{(result.confidence * 100).toFixed(1)}<span className="text-2xl">%</span></span>
                          <span className="text-xs text-green-500 mb-2 font-mono uppercase">Validated</span>
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

                  {(image || c2paScanning || c2paResult) && (
                    <C2paCredentialsPanel scanning={c2paScanning} result={c2paResult} />
                  )}

                  {/* Coordinates Section */}
                  <section className="space-y-4">
                    <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold block">Target Geo-Coordinates</label>
                    <div className="bg-white/5 border border-white/10 rounded-lg p-4 space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] text-gray-500 font-mono uppercase">Latitude</span>
                        <span className="font-mono text-sm text-cyan-400">
                          {result ? `${result.coordinates.lat.toFixed(4)}° N` : '---.----'}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] text-gray-500 font-mono uppercase">Longitude</span>
                        <span className="font-mono text-sm text-cyan-400">
                          {result ? `${result.coordinates.lng.toFixed(4)}° E` : '---.----'}
                        </span>
                      </div>
                      {result && (
                        <div className="flex gap-2 mt-2">
                          <button 
                            onClick={() => window.open(`https://www.google.com/maps/search/?api=1&query=${result.coordinates.lat},${result.coordinates.lng}`, '_blank')}
                            className="flex-1 py-2 bg-white/5 border border-white/10 rounded text-[10px] text-gray-400 hover:bg-white/10 hover:text-white transition-all uppercase tracking-widest"
                          >
                            Earth View
                          </button>
                          <button 
                            onClick={() => copyToClipboard(`${result.coordinates.lat}, ${result.coordinates.lng}`)}
                            className="px-3 py-2 bg-white/5 border border-white/10 rounded text-[10px] text-gray-400 hover:bg-white/10 hover:text-white transition-all uppercase tracking-widest flex items-center justify-center"
                            title="Copy Coordinates"
                          >
                            <Upload className="w-3 h-3 rotate-180" />
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

                  {/* Components / Search Queries */}
                  {result?.searchQueriesExecuted && result.searchQueriesExecuted.length > 0 && (
                    <section className="space-y-3">
                      <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold block">Queries Executed</label>
                      <div className="flex flex-wrap gap-2">
                        {result.searchQueriesExecuted.map((q, i) => (
                          <div key={i} className="px-2 py-1 bg-white/5 border border-white/10 rounded text-[10px] text-gray-300 font-mono flex items-center gap-1.5">
                            <Search className="w-3 h-3 text-cyan-500" />
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
                      <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold block">Enhanced Grounding</label>
                      <div 
                        className="bg-white/5 border border-white/10 rounded-lg p-2 min-h-[40px] overflow-hidden [&_a]:text-cyan-400 [&_a]:hover:underline"
                        dangerouslySetInnerHTML={{ __html: result.searchEntryPointHtml }}
                      />
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
                              <p className="text-[10px] text-gray-600 font-mono uppercase tracking-tighter">Feature Confirmed</p>
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
                  <div className="flex flex-col gap-4 px-2">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">Encrypted Archive</label>
                    </div>
                    {history.length > 0 && (
                      <button 
                        onClick={() => { if(confirm('Are you sure you want to clear ALL historical records? This action is irreversible.')) setHistory([]) }}
                        className="w-full py-2.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded text-[10px] font-bold text-red-500 tracking-[0.2em] transition-all flex items-center justify-center gap-2"
                      >
                        <Trash2 className="w-3 h-3" /> CLEAR HISTORY ARCHIVE
                      </button>
                    )}
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
                              <C2paHistoryIcon c2pa={item.c2pa} />
                              <span className="text-[9px] text-cyan-600 font-mono">{(item.result.confidence * 100).toFixed(0)}% CONF</span>
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
              SESSION_TOKEN: 0x921A_F2<br/>
              DECODING: {isAnalyzing ? 'ACTIVE' : 'STANDBY'}<br/>
              BUFFER: 100%
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
                  {result ? (
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
                      <MapController center={mapCenter} />
                    </MapContainer>
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center opacity-10 bg-[radial-gradient(#ffffff10_1px,transparent_1px)] bg-[size:16px_16px]">
                      <Compass className="w-10 h-10" />
                    </div>
                  )}
                  <div className="absolute bottom-2 left-2 px-2 py-1 bg-black/80 rounded border border-white/10 text-[7px] font-mono text-cyan-400 uppercase tracking-[0.2em] pointer-events-none">
                    Map_Link: Active
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

                  {(image || c2paScanning || c2paResult) && (
                    <>
                      <div className="space-y-1">
                        <span className="text-[9px] text-gray-500 uppercase font-bold tracking-widest block">Content Credentials</span>
                        <span className={`text-[10px] font-mono uppercase tracking-widest block ${
                          c2paResult?.status === 'present_valid_ai_claimed' || c2paResult?.status === 'present_unverified'
                            ? 'text-amber-400'
                            : c2paResult?.status === 'present_valid'
                              ? 'text-cyan-400'
                              : 'text-gray-500'
                        }`}>
                          {c2paScanning ? 'C2PA: SCANNING…' : getC2paChipLabel(c2paResult)}
                        </span>
                      </div>
                      <div className="hidden lg:block w-[1px] h-6 bg-white/10" />
                    </>
                  )}

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
              <div 
                {...getRootProps()} 
                className={`
                  w-full max-w-2xl h-[400px] border-2 border-dashed rounded-lg transition-all 
                  flex flex-col items-center justify-center text-center gap-4
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
            ) : (
              <div className="relative flex flex-col items-center">
                <div className={`relative group transition-transform ${isAnalyzing ? 'scale-105' : ''}`}>
                  <C2paImageBadge scanning={c2paScanning} result={c2paResult} />
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
                    className="mt-6 px-4 py-2 bg-red-950/40 border border-red-500/40 rounded text-xs text-red-400 font-mono"
                  >
                    SYS_ERR: {error}
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
                     LOCUS Uplink _
                   </span>
                   <span className="text-[8px] font-mono text-cyan-600 uppercase tracking-widest leading-none">
                     Secure Channel Engaged
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
                    <span className="text-xs font-mono text-cyan-600 animate-pulse">Processing query via uplink</span>
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
                 System: Gemini 2.5 Flash / End-to-End Encryption
              </div>
            </div>
          </aside>
        )}
      </main>

      {/* Footer Status Bar */}
      <footer className="h-10 bg-[#0f0f0f] border-t border-white/10 px-6 flex items-center justify-between shrink-0">
        <div className="flex gap-6 text-[10px] font-mono text-gray-600 uppercase tracking-tight">
          <span>VERSION = 0.2</span>
          <span>Latency: <span className="text-gray-400">12ms</span></span>
          <span className="text-cyan-800">Cores: 16_ACTIVE</span>
        </div>
        <div className="text-[10px] text-gray-600 font-mono uppercase tracking-[0.2em]">
          Vibecoded by Pavel "Pogoda" Bannikov for Provereno.Media
        </div>
      </footer>
    </div>
  );
}
