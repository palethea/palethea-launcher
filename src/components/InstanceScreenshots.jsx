import { useState, useEffect, useCallback, useLayoutEffect, useRef, useMemo, memo } from 'react';
import { createPortal } from 'react-dom';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { Pencil, Square, ArrowRight, Triangle, Undo2, Redo2, Save, Copy, RotateCcw, Minus, Plus } from 'lucide-react';
import ConfirmModal from './ConfirmModal';
import TabLoadingState from './TabLoadingState';
import SubTabs from './SubTabs';
import CustomColorPicker from './CustomColorPicker';
import './ScreenshotContextMenu.css';

const EDITOR_TOOLS = [
  { id: 'freehand', label: 'Draw', icon: Pencil },
  { id: 'square', label: 'Square', icon: Square },
  { id: 'arrow', label: 'Arrow', icon: ArrowRight },
  { id: 'triangle', label: 'Triangle', icon: Triangle }
];

const EDITOR_PRESET_COLORS = ['#ff4d4f', '#22c55e', '#3b82f6', '#facc15', '#ffffff', '#000000'];

function applyStrokeStyle(ctx, color, lineWidth) {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

function getConstrainedEndPoint(startX, startY, endX, endY) {
  const dx = endX - startX;
  const dy = endY - startY;
  const size = Math.max(Math.abs(dx), Math.abs(dy));
  const safeXSign = dx === 0 ? 1 : Math.sign(dx);
  const safeYSign = dy === 0 ? 1 : Math.sign(dy);
  return {
    x: startX + size * safeXSign,
    y: startY + size * safeYSign
  };
}

function drawArrowShape(ctx, startX, startY, endX, endY) {
  const headLength = Math.max(10, ctx.lineWidth * 3.6);
  const angle = Math.atan2(endY - startY, endX - startX);
  const wingAngle = Math.PI / 7;

  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.lineTo(endX, endY);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(endX, endY);
  ctx.lineTo(
    endX - headLength * Math.cos(angle - wingAngle),
    endY - headLength * Math.sin(angle - wingAngle)
  );
  ctx.moveTo(endX, endY);
  ctx.lineTo(
    endX - headLength * Math.cos(angle + wingAngle),
    endY - headLength * Math.sin(angle + wingAngle)
  );
  ctx.lineTo(endX, endY);
  ctx.stroke();
}

function drawTriangleShape(ctx, startX, startY, endX, endY, options = {}) {
  const { constrain = false } = options;
  let finalEndX = endX;
  let finalEndY = endY;

  if (constrain) {
    const constrainedPoint = getConstrainedEndPoint(startX, startY, endX, endY);
    finalEndX = constrainedPoint.x;
    finalEndY = constrainedPoint.y;
  }

  const minHeight = Math.max(2, ctx.lineWidth * 0.85);
  const left = Math.min(startX, finalEndX);
  const right = Math.max(startX, finalEndX);
  const top = Math.min(startY, finalEndY);
  const bottom = Math.max(startY, finalEndY, top + minHeight);
  const apexX = left + (right - left) / 2;

  ctx.beginPath();
  ctx.moveTo(apexX, top);
  ctx.lineTo(right, bottom);
  ctx.lineTo(left, bottom);
  ctx.closePath();
  ctx.stroke();
}

function drawEditorShape(ctx, tool, startX, startY, endX, endY, options = {}) {
  const { constrain = false } = options;

  if (tool === 'square') {
    let drawEndX = endX;
    let drawEndY = endY;
    if (constrain) {
      const constrainedPoint = getConstrainedEndPoint(startX, startY, endX, endY);
      drawEndX = constrainedPoint.x;
      drawEndY = constrainedPoint.y;
    }
    const x = Math.min(startX, drawEndX);
    const y = Math.min(startY, drawEndY);
    const width = Math.abs(drawEndX - startX);
    const height = Math.abs(drawEndY - startY);
    ctx.strokeRect(x, y, width, height);
    return;
  }

  if (tool === 'arrow') {
    drawArrowShape(ctx, startX, startY, endX, endY);
    return;
  }

  if (tool === 'triangle') {
    drawTriangleShape(ctx, startX, startY, endX, endY, { constrain });
  }
}

function drawEditorOperation(ctx, operation) {
  if (!operation) return;
  applyStrokeStyle(ctx, operation.color, operation.lineWidth);

  if (operation.tool === 'freehand') {
    const points = operation.points || [];
    if (points.length === 0) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    if (points.length === 1) {
      ctx.lineTo(points[0].x, points[0].y);
    } else {
      for (let index = 1; index < points.length; index += 1) {
        ctx.lineTo(points[index].x, points[index].y);
      }
    }
    ctx.stroke();
    return;
  }

  drawEditorShape(
    ctx,
    operation.tool,
    operation.startX,
    operation.startY,
    operation.endX,
    operation.endY,
    { constrain: Boolean(operation.constrain) }
  );
}

function InstanceScreenshots({ instance, onShowNotification, isScrolled }) {
  const [screenshots, setScreenshots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedImage, setSelectedImage] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState({ show: false, screenshot: null });
  const [copiedId, setCopiedId] = useState(null);
  const [screenshotContextMenu, setScreenshotContextMenu] = useState(null);
  const [renameModal, setRenameModal] = useState({ show: false, screenshot: null, newName: '' });
  const [toast, setToast] = useState(null);
  const [activeSubTab, setActiveSubTab] = useState('gallery');
  const [editorScreenshot, setEditorScreenshot] = useState(null);
  const [editorTool, setEditorTool] = useState('freehand');
  const [editorColor, setEditorColor] = useState(EDITOR_PRESET_COLORS[0]);
  const [editorStrokeWidth, setEditorStrokeWidth] = useState(4);
  const [editorLoading, setEditorLoading] = useState(false);
  const [editorHistoryState, setEditorHistoryState] = useState({ index: 0, total: 0 });
  const [showEditorColorPicker, setShowEditorColorPicker] = useState(false);
  const screenshotContextMenuRef = useRef(null);
  const editorColorPickerRef = useRef(null);
  const editorCanvasRef = useRef(null);
  const editorBaseCanvasRef = useRef(document.createElement('canvas'));
  const editorDrawLayerCanvasRef = useRef(document.createElement('canvas'));
  const editorOperationsRef = useRef([]);
  const editorHistoryIndexRef = useRef(0);
  const editorFreehandPointsRef = useRef([]);
  const editorRafRef = useRef(null);
  const editorToolRef = useRef(editorTool);
  const editorColorRef = useRef(editorColor);
  const editorStrokeWidthRef = useRef(editorStrokeWidth);
  const activeSubTabRef = useRef(activeSubTab);
  const editorUndoHandlerRef = useRef(() => {});
  const editorRedoHandlerRef = useRef(() => {});
  const editorPointerRef = useRef({
    isDrawing: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    currentX: 0,
    currentY: 0,
    constrain: false,
    tool: 'freehand',
    color: EDITOR_PRESET_COLORS[0],
    lineWidth: 4
  });

  const sortedScreenshots = useMemo(() => {
    return [...screenshots].sort((left, right) => {
      const leftTime = left?.date ? new Date(left.date).getTime() : 0;
      const rightTime = right?.date ? new Date(right.date).getTime() : 0;
      return rightTime - leftTime;
    });
  }, [screenshots]);

  const syncEditorHistoryState = useCallback(() => {
    setEditorHistoryState({
      index: editorHistoryIndexRef.current,
      total: editorOperationsRef.current.length
    });
  }, []);

  const redrawEditorDrawLayer = useCallback(() => {
    const drawLayerCanvas = editorDrawLayerCanvasRef.current;
    const drawCtx = drawLayerCanvas.getContext('2d');
    if (!drawCtx) return;

    drawCtx.clearRect(0, 0, drawLayerCanvas.width, drawLayerCanvas.height);
    const activeCount = editorHistoryIndexRef.current;
    const operations = editorOperationsRef.current;
    for (let index = 0; index < activeCount; index += 1) {
      drawEditorOperation(drawCtx, operations[index]);
    }
  }, []);

  useEffect(() => {
    editorToolRef.current = editorTool;
  }, [editorTool]);

  useEffect(() => {
    editorColorRef.current = editorColor;
  }, [editorColor]);

  useEffect(() => {
    editorStrokeWidthRef.current = editorStrokeWidth;
  }, [editorStrokeWidth]);

  useEffect(() => {
    activeSubTabRef.current = activeSubTab;
  }, [activeSubTab]);

  const renderEditorCanvas = useCallback(() => {
    const canvas = editorCanvasRef.current;
    const baseCanvas = editorBaseCanvasRef.current;
    const drawLayerCanvas = editorDrawLayerCanvasRef.current;

    if (
      !canvas ||
      !baseCanvas ||
      !drawLayerCanvas ||
      !canvas.width ||
      !canvas.height
    ) {
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(baseCanvas, 0, 0);
    ctx.drawImage(drawLayerCanvas, 0, 0);

    const pointer = editorPointerRef.current;
    if (pointer.isDrawing && pointer.tool !== 'freehand') {
      applyStrokeStyle(ctx, pointer.color, pointer.lineWidth);
      drawEditorShape(
        ctx,
        pointer.tool,
        pointer.startX,
        pointer.startY,
        pointer.currentX,
        pointer.currentY,
        { constrain: pointer.constrain }
      );
    }
  }, []);

  const scheduleEditorRender = useCallback(() => {
    if (editorRafRef.current !== null) {
      return;
    }
    editorRafRef.current = requestAnimationFrame(() => {
      editorRafRef.current = null;
      renderEditorCanvas();
    });
  }, [renderEditorCanvas]);

  const commitEditorOperation = useCallback((operation) => {
    if (!operation) return;
    const nextOperations = editorOperationsRef.current.slice(0, editorHistoryIndexRef.current);
    nextOperations.push(operation);
    editorOperationsRef.current = nextOperations;
    editorHistoryIndexRef.current = nextOperations.length;
    redrawEditorDrawLayer();
    syncEditorHistoryState();
    scheduleEditorRender();
  }, [redrawEditorDrawLayer, scheduleEditorRender, syncEditorHistoryState]);

  const handleEditorUndo = useCallback(() => {
    if (editorHistoryIndexRef.current <= 0) return;
    editorHistoryIndexRef.current -= 1;
    redrawEditorDrawLayer();
    syncEditorHistoryState();
    scheduleEditorRender();
  }, [redrawEditorDrawLayer, scheduleEditorRender, syncEditorHistoryState]);

  const handleEditorRedo = useCallback(() => {
    if (editorHistoryIndexRef.current >= editorOperationsRef.current.length) return;
    editorHistoryIndexRef.current += 1;
    redrawEditorDrawLayer();
    syncEditorHistoryState();
    scheduleEditorRender();
  }, [redrawEditorDrawLayer, scheduleEditorRender, syncEditorHistoryState]);

  useEffect(() => {
    editorUndoHandlerRef.current = handleEditorUndo;
    editorRedoHandlerRef.current = handleEditorRedo;
  }, [handleEditorRedo, handleEditorUndo]);

  const loadScreenshots = useCallback(async () => {
    try {
      const ss = await invoke('get_instance_screenshots', { instanceId: instance.id });
      setScreenshots(ss);
    } catch (error) {
      console.error('Failed to load screenshots:', error);
    }
    setLoading(false);
  }, [instance.id]);

  useEffect(() => {
    loadScreenshots();

    const handleClick = () => {
      setScreenshotContextMenu(null);
    };
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, [instance.id, loadScreenshots]);

  useEffect(() => {
    return () => {
      if (editorRafRef.current !== null) {
        cancelAnimationFrame(editorRafRef.current);
        editorRafRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (screenshots.length === 0) {
      setEditorScreenshot(null);
      if (activeSubTab === 'editor') {
        setActiveSubTab('gallery');
      }
      return;
    }

    if (!editorScreenshot) {
      setEditorScreenshot(sortedScreenshots[0] || screenshots[0]);
      return;
    }

    const stillExists = screenshots.some((ss) => ss.filename === editorScreenshot.filename);
    if (!stillExists) {
      setEditorScreenshot(sortedScreenshots[0] || screenshots[0] || null);
    }
  }, [activeSubTab, editorScreenshot, screenshots, sortedScreenshots]);

  useEffect(() => {
    if (!showEditorColorPicker) return;

    const handleClickOutside = (event) => {
      const target = event.target;
      if (editorColorPickerRef.current && !editorColorPickerRef.current.contains(target)) {
        setShowEditorColorPicker(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showEditorColorPicker]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (activeSubTabRef.current !== 'editor') return;

      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const inputType = target.tagName === 'INPUT'
        ? (target.getAttribute('type') || 'text').toLowerCase()
        : '';
      const isTextEntryTarget =
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable ||
        (target.tagName === 'INPUT' && !['range', 'button', 'checkbox', 'radio', 'color'].includes(inputType));

      if (isTextEntryTarget) {
        return;
      }

      const isModifierPressed = event.ctrlKey || event.metaKey;
      if (!isModifierPressed) return;

      const key = event.key.toLowerCase();
      if (key === 'z' && event.shiftKey) {
        event.preventDefault();
        editorRedoHandlerRef.current();
        return;
      }

      if (key === 'z') {
        event.preventDefault();
        editorUndoHandlerRef.current();
        return;
      }

      if (key === 'y') {
        event.preventDefault();
        editorRedoHandlerRef.current();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, []);

  useLayoutEffect(() => {
    if (!screenshotContextMenu || !screenshotContextMenuRef.current) return;

    const rect = screenshotContextMenuRef.current.getBoundingClientRect();
    const margin = 12;
    const maxX = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxY = Math.max(margin, window.innerHeight - rect.height - margin);
    const clampedX = Math.min(Math.max(screenshotContextMenu.x, margin), maxX);
    const clampedY = Math.min(Math.max(screenshotContextMenu.y, margin), maxY);

    if (clampedX !== screenshotContextMenu.x || clampedY !== screenshotContextMenu.y || !screenshotContextMenu.positioned) {
      setScreenshotContextMenu(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          x: clampedX,
          y: clampedY,
          positioned: true
        };
      });
    }
  }, [screenshotContextMenu]);

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  const debugLog = (message, data = null) => {
    if (import.meta.env.DEV) {
      const fullMessage = data ? `${message} ${JSON.stringify(data)}` : message;
      invoke('log_event', {
        level: 'info',
        message: `[JS DEBUG] ${fullMessage}`
      }).catch(() => { });
    }
  };

  const handleOpenFolder = async () => {
    try {
      await invoke('open_instance_folder', {
        instanceId: instance.id,
        folderType: 'screenshots'
      });
    } catch (error) {
      console.error('Failed to open folder:', error);      if (onShowNotification) {
        onShowNotification(`Failed to open screenshots folder: ${error}`, 'error');
      }    }
  };

  const handleDelete = async (screenshot) => {
    setDeleteConfirm({ show: true, screenshot });
  };

  const handleSubTabChange = useCallback((nextTab) => {
    if (nextTab === 'editor' && !editorScreenshot && sortedScreenshots.length > 0) {
      setEditorScreenshot(sortedScreenshots[0]);
    }
    if (nextTab !== 'editor') {
      setShowEditorColorPicker(false);
    }
    setActiveSubTab(nextTab);
  }, [editorScreenshot, sortedScreenshots]);

  const handleEditScreenshot = useCallback((screenshot) => {
    setEditorScreenshot(screenshot);
    setActiveSubTab('editor');
    setSelectedImage(null);
    setScreenshotContextMenu(null);
    setShowEditorColorPicker(false);
  }, []);

  const confirmDelete = async () => {
    const screenshot = deleteConfirm.screenshot;
    setDeleteConfirm({ show: false, screenshot: null });

    try {
      await invoke('delete_instance_screenshot', {
        instanceId: instance.id,
        filename: screenshot.filename
      });
      await loadScreenshots();
      showToast('Screenshot deleted');
    } catch (error) {
      console.error('Failed to delete screenshot:', error);
      showToast('Failed to delete screenshot');
    }
  };

  const handleCopy = async (ss) => {
    debugLog('--- START COPY ATTEMPT ---');
    debugLog('Screenshot:', ss.filename);

    try {
      if (!window.ClipboardItem) {
        debugLog('ERROR: ClipboardItem API is not available.');
        showToast('Clipboard API not supported');
        return;
      }

      const srcUrl = convertFileSrc(ss.path);
      debugLog('File URL:', srcUrl);

      debugLog('Writing to clipboard (direct promise approach)...');
      
      // Create ClipboardItem with a Promise for the blob. 
      // This preserves user activation context which is often lost on Linux/WebKit 
      // when awaiting fetch/blob before calling the clipboard API.
      const clipboardBlobPromise = fetch(srcUrl)
        .then((response) => {
          if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
          return response.blob();
        })
        .catch((fetchError) => {
          debugLog('ERROR: Screenshot fetch failed', {
            message: fetchError.message,
            name: fetchError.name
          });
          throw fetchError;
        });

      const item = new ClipboardItem({
        'image/png': clipboardBlobPromise
      });

      await navigator.clipboard.write([item]);

      debugLog('SUCCESS: Clipboard write finished.');
      setCopiedId(ss.filename);
      showToast('Copied to clipboard!');
      setTimeout(() => setCopiedId(null), 2000);
    } catch (error) {
      debugLog('FATAL: Copy failed', {
        message: error.message,
        name: error.name,
        stack: error.stack
      });
      showToast('Failed to copy to clipboard');
    }
  };

  const handleScreenshotContextMenu = (e, ss) => {
    e.preventDefault();
    e.stopPropagation();

    setScreenshotContextMenu({
      x: e.clientX + 2,
      y: e.clientY + 2,
      positioned: false,
      screenshot: ss
    });
  };

  const handleRename = async () => {
    const { screenshot, newName } = renameModal;
    if (!newName || newName === screenshot.filename) {
      setRenameModal({ show: false, screenshot: null, newName: '' });
      return;
    }

    try {
      await invoke('rename_instance_screenshot', {
        instanceId: instance.id,
        oldFilename: screenshot.filename,
        newFilename: newName
      });
      showToast('Screenshot renamed');
      await loadScreenshots();
    } catch (error) {
      showToast(`Rename failed: ${error}`);
    }
    setRenameModal({ show: false, screenshot: null, newName: '' });
  };

  const handleOpenScreenshot = async (ss) => {
    try {
      await invoke('open_instance_screenshot', {
        instanceId: instance.id,
        filename: ss.filename
      });
    } catch (error) {
      showToast(`Failed to open: ${error}`);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return 'Unknown';
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getCanvasCoordinates = useCallback((event) => {
    const canvas = editorCanvasRef.current;
    if (!canvas) {
      return { x: 0, y: 0 };
    }

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY
    };
  }, []);

  const loadEditorScreenshot = useCallback(async (screenshot) => {
    const canvas = editorCanvasRef.current;
    if (!screenshot || !canvas) {
      return;
    }

    setEditorLoading(true);
    try {
      const sourceUrl = convertFileSrc(screenshot.path);
      const response = await fetch(sourceUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch screenshot: ${response.status}`);
      }

      const blob = await response.blob();
      let drawSource = null;
      let objectUrl = null;
      let width = 0;
      let height = 0;

      if (typeof createImageBitmap === 'function') {
        try {
          const bitmap = await createImageBitmap(blob);
          drawSource = bitmap;
          width = bitmap.width;
          height = bitmap.height;
        } catch {
          objectUrl = URL.createObjectURL(blob);
          const image = new Image();
          const imageReady = new Promise((resolve, reject) => {
            image.onload = resolve;
            image.onerror = reject;
          });
          image.src = objectUrl;
          await imageReady;
          drawSource = image;
          width = image.naturalWidth || image.width;
          height = image.naturalHeight || image.height;
        }
      } else {
        objectUrl = URL.createObjectURL(blob);
        const image = new Image();
        const imageReady = new Promise((resolve, reject) => {
          image.onload = resolve;
          image.onerror = reject;
        });
        image.src = objectUrl;
        await imageReady;
        drawSource = image;
        width = image.naturalWidth || image.width;
        height = image.naturalHeight || image.height;
      }

      if (!width || !height) {
        throw new Error('Image dimensions are invalid.');
      }

      const baseCanvas = editorBaseCanvasRef.current;
      const drawLayerCanvas = editorDrawLayerCanvasRef.current;
      [canvas, baseCanvas, drawLayerCanvas].forEach((targetCanvas) => {
        targetCanvas.width = width;
        targetCanvas.height = height;
      });

      const baseCtx = baseCanvas.getContext('2d');
      const drawCtx = drawLayerCanvas.getContext('2d');
      if (!baseCtx || !drawCtx) {
        throw new Error('Canvas context unavailable.');
      }

      baseCtx.clearRect(0, 0, width, height);
      baseCtx.drawImage(drawSource, 0, 0, width, height);
      drawCtx.clearRect(0, 0, width, height);

      if (drawSource && typeof drawSource.close === 'function') {
        drawSource.close();
      }
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }

      editorOperationsRef.current = [];
      editorHistoryIndexRef.current = 0;
      editorFreehandPointsRef.current = [];
      syncEditorHistoryState();

      editorPointerRef.current = {
        isDrawing: false,
        pointerId: null,
        startX: 0,
        startY: 0,
        lastX: 0,
        lastY: 0,
        currentX: 0,
        currentY: 0,
        constrain: false,
        tool: editorToolRef.current,
        color: editorColorRef.current,
        lineWidth: editorStrokeWidthRef.current
      };

      scheduleEditorRender();
    } catch (error) {
      console.error('Failed to load screenshot into editor:', error);
      showToast('Failed to load screenshot into editor');
    } finally {
      setEditorLoading(false);
    }
  }, [scheduleEditorRender, syncEditorHistoryState]);

  useEffect(() => {
    if (activeSubTab !== 'editor' || !editorScreenshot) {
      return;
    }
    loadEditorScreenshot(editorScreenshot);
  }, [activeSubTab, editorScreenshot, loadEditorScreenshot]);

  useEffect(() => {
    if (activeSubTab === 'editor' && editorScreenshot) {
      scheduleEditorRender();
    }
  }, [activeSubTab, editorColor, editorStrokeWidth, editorTool, editorScreenshot, scheduleEditorRender]);

  const handleEditorPointerDown = useCallback((event) => {
    const canvas = editorCanvasRef.current;
    if (!canvas || !editorScreenshot || event.button !== 0) {
      return;
    }

    event.preventDefault();
    const { x, y } = getCanvasCoordinates(event);
    const pointer = editorPointerRef.current;

    pointer.isDrawing = true;
    pointer.pointerId = event.pointerId;
    pointer.startX = x;
    pointer.startY = y;
    pointer.lastX = x;
    pointer.lastY = y;
    pointer.currentX = x;
    pointer.currentY = y;
    pointer.constrain = event.shiftKey;
    pointer.tool = editorToolRef.current;
    pointer.color = editorColorRef.current;
    pointer.lineWidth = editorStrokeWidthRef.current;

    canvas.setPointerCapture?.(event.pointerId);

    if (pointer.tool === 'freehand') {
      editorFreehandPointsRef.current = [{ x, y }];
      const drawCtx = editorDrawLayerCanvasRef.current.getContext('2d');
      if (!drawCtx) {
        return;
      }
      applyStrokeStyle(drawCtx, pointer.color, pointer.lineWidth);
      drawCtx.beginPath();
      drawCtx.moveTo(x, y);
      drawCtx.lineTo(x, y);
      drawCtx.stroke();
      scheduleEditorRender();
    }
  }, [editorScreenshot, getCanvasCoordinates, scheduleEditorRender]);

  const handleEditorPointerMove = useCallback((event) => {
    const pointer = editorPointerRef.current;
    if (!pointer.isDrawing || pointer.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    const { x, y } = getCanvasCoordinates(event);
    pointer.currentX = x;
    pointer.currentY = y;
    pointer.constrain = event.shiftKey;

    if (pointer.tool === 'freehand') {
      const drawCtx = editorDrawLayerCanvasRef.current.getContext('2d');
      if (!drawCtx) {
        return;
      }

      applyStrokeStyle(drawCtx, pointer.color, pointer.lineWidth);
      drawCtx.beginPath();
      drawCtx.moveTo(pointer.lastX, pointer.lastY);
      drawCtx.lineTo(x, y);
      drawCtx.stroke();

      editorFreehandPointsRef.current.push({ x, y });
      pointer.lastX = x;
      pointer.lastY = y;
    }

    scheduleEditorRender();
  }, [getCanvasCoordinates, scheduleEditorRender]);

  const finalizeEditorStroke = useCallback((event, cancelled = false) => {
    const pointer = editorPointerRef.current;
    if (!pointer.isDrawing) {
      return;
    }

    if (event && pointer.pointerId !== event.pointerId) {
      return;
    }

    let nextOperation = null;
    if (!cancelled) {
      if (pointer.tool === 'freehand') {
        const points = editorFreehandPointsRef.current;
        if (points.length > 0) {
          nextOperation = {
            tool: 'freehand',
            points: [...points],
            color: pointer.color,
            lineWidth: pointer.lineWidth
          };
        }
      } else {
        nextOperation = {
          tool: pointer.tool,
          startX: pointer.startX,
          startY: pointer.startY,
          endX: pointer.currentX,
          endY: pointer.currentY,
          constrain: pointer.constrain,
          color: pointer.color,
          lineWidth: pointer.lineWidth
        };
      }
    }

    if (nextOperation) {
      commitEditorOperation(nextOperation);
    } else if (cancelled && pointer.tool === 'freehand') {
      redrawEditorDrawLayer();
      scheduleEditorRender();
    }

    const canvas = editorCanvasRef.current;
    if (event && canvas?.hasPointerCapture?.(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }

    pointer.isDrawing = false;
    pointer.pointerId = null;
    pointer.constrain = false;
    editorFreehandPointsRef.current = [];
    scheduleEditorRender();
  }, [commitEditorOperation, redrawEditorDrawLayer, scheduleEditorRender]);

  const handleEditorReset = useCallback(() => {
    editorOperationsRef.current = [];
    editorHistoryIndexRef.current = 0;
    editorFreehandPointsRef.current = [];
    editorPointerRef.current.isDrawing = false;
    editorPointerRef.current.pointerId = null;
    editorPointerRef.current.constrain = false;
    redrawEditorDrawLayer();
    syncEditorHistoryState();
    scheduleEditorRender();
  }, [redrawEditorDrawLayer, scheduleEditorRender, syncEditorHistoryState]);

  const handleEditorDownload = useCallback(async () => {
    const canvas = editorCanvasRef.current;
    if (!canvas || !editorScreenshot) {
      showToast('No edited screenshot to save');
      return;
    }

    try {
      const blob = await new Promise((resolve, reject) => {
        try {
          canvas.toBlob((value) => {
            if (value) {
              resolve(value);
              return;
            }
            reject(new Error('Failed to create image blob.'));
          }, 'image/png');
        } catch (error) {
          reject(error);
        }
      });

      const pngBase64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      const savedPath = await invoke('save_instance_edited_screenshot', {
        instanceId: instance.id,
        originalFilename: editorScreenshot.filename,
        pngBase64
      });
      await loadScreenshots();

      const savedFilename = String(savedPath).split(/[\\/]/).pop() || 'edited screenshot';
      showToast(`Saved ${savedFilename} in instance screenshots folder`);
    } catch (error) {
      console.error('Failed to save edited screenshot:', error);
      showToast('Failed to save edited screenshot');
    }
  }, [editorScreenshot, instance.id, loadScreenshots]);

  const handleEditorCopy = useCallback(async () => {
    const canvas = editorCanvasRef.current;
    if (!canvas) {
      showToast('No edited screenshot to copy');
      return;
    }

    if (!window.ClipboardItem || !navigator.clipboard?.write) {
      showToast('Clipboard API not supported');
      return;
    }

    try {
      const blob = await new Promise((resolve, reject) => {
        try {
          canvas.toBlob((value) => {
            if (value) {
              resolve(value);
              return;
            }
            reject(new Error('Failed to create image blob.'));
          }, 'image/png');
        } catch (error) {
          reject(error);
        }
      });

      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      showToast('Edited screenshot copied');
    } catch (error) {
      console.error('Failed to copy edited screenshot:', error);
      showToast('Failed to copy edited screenshot');
    }
  }, []);

  const canEditorUndo = editorHistoryState.index > 0;
  const canEditorRedo = editorHistoryState.index < editorHistoryState.total;
  const decreaseThickness = useCallback(() => {
    setEditorStrokeWidth((current) => Math.max(1, current - 1));
  }, []);
  const increaseThickness = useCallback(() => {
    setEditorStrokeWidth((current) => Math.min(24, current + 1));
  }, []);

  if (loading) {
    return (
      <div className="screenshots-tab">
        <div className={`sub-tabs-row ${isScrolled ? 'scrolled' : ''}`}>
          <SubTabs
            tabs={[
              { id: 'gallery', label: 'Gallery' },
              { id: 'timeline', label: 'Timeline' },
              { id: 'editor', label: 'Editor' }
            ]}
            activeTab={activeSubTab}
            onTabChange={handleSubTabChange}
          />
          <div className="sub-tabs-actions">
            <button className="open-folder-btn" disabled title="Open Screenshots Folder">
              📁 Folder
            </button>
          </div>
        </div>
        <TabLoadingState label="Loading screenshots" rows={4} />
      </div>
    );
  }

  return (
    <div className="screenshots-tab">
      <div className={`sub-tabs-row ${isScrolled ? 'scrolled' : ''}`}>
        <SubTabs
          tabs={[
            { id: 'gallery', label: `Gallery (${screenshots.length})` },
            { id: 'timeline', label: 'Timeline' },
            { id: 'editor', label: 'Editor' }
          ]}
          activeTab={activeSubTab}
          onTabChange={handleSubTabChange}
        />
        <div className="sub-tabs-actions">
          <button className="open-folder-btn" onClick={handleOpenFolder} title="Open Screenshots Folder">
            📁 Folder
          </button>
        </div>
      </div>

      {screenshots.length === 0 ? (
        <div className="empty-state">
          <h4>No screenshots yet</h4>
          <p>Press F2 in-game to take screenshots.</p>
        </div>
      ) : activeSubTab === 'editor' ? (
        <div className="screenshot-editor">
          <div className="screenshot-editor-toolbar">
            <div className="editor-toolbar-group">
              <div className="editor-tool-buttons">
                {EDITOR_TOOLS.map((tool) => (
                  <button
                    key={tool.id}
                    type="button"
                    className={`editor-tool-btn ${editorTool === tool.id ? 'active' : ''}`}
                    onClick={() => setEditorTool(tool.id)}
                    title={tool.label}
                    aria-label={tool.label}
                  >
                    <tool.icon size={14} />
                  </button>
                ))}
              </div>
            </div>

            <div className="editor-toolbar-group">
              <div className="editor-color-picker-anchor" ref={editorColorPickerRef}>
                <button
                  type="button"
                  className="editor-color-picker-trigger"
                  style={{ '--editor-color-preview': editorColor }}
                  onClick={() => setShowEditorColorPicker((current) => !current)}
                  aria-label="Open color picker"
                  title="Color picker"
                />
                {showEditorColorPicker && (
                  <div className="editor-color-picker-popover">
                    <CustomColorPicker value={editorColor} onChange={setEditorColor} />
                  </div>
                )}
              </div>
              <div className="editor-color-palette">
                {EDITOR_PRESET_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`editor-color-chip ${editorColor === color ? 'active' : ''}`}
                    style={{ '--chip-color': color }}
                    onClick={() => setEditorColor(color)}
                    aria-label={`Select ${color} color`}
                  />
                ))}
              </div>
            </div>

            <div className="editor-toolbar-group">
              <div className="editor-thickness-control">
                <button type="button" className="editor-thickness-step" onClick={decreaseThickness} aria-label="Decrease thickness" title="Decrease thickness">
                  <Minus size={12} />
                </button>
                <input
                  type="range"
                  min="1"
                  max="24"
                  step="1"
                  value={editorStrokeWidth}
                  onChange={(event) => setEditorStrokeWidth(Number(event.target.value))}
                />
                <button type="button" className="editor-thickness-step" onClick={increaseThickness} aria-label="Increase thickness" title="Increase thickness">
                  <Plus size={12} />
                </button>
              </div>
            </div>

            <div className="editor-toolbar-group editor-actions-group">
              <button type="button" className="editor-action-btn" disabled={!canEditorUndo} onClick={handleEditorUndo} title="Undo (Ctrl+Z)" aria-label="Undo">
                <Undo2 size={14} />
              </button>
              <button type="button" className="editor-action-btn" disabled={!canEditorRedo} onClick={handleEditorRedo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
                <Redo2 size={14} />
              </button>
              <button type="button" className="editor-action-btn" onClick={handleEditorDownload} title="Save to screenshot folder" aria-label="Save">
                <Save size={14} />
              </button>
              <button type="button" className="editor-action-btn" onClick={handleEditorCopy} title="Copy edited image" aria-label="Copy">
                <Copy size={14} />
              </button>
              <button type="button" className="editor-action-btn danger" onClick={handleEditorReset} title="Reset drawing" aria-label="Reset">
                <RotateCcw size={14} />
              </button>
            </div>
          </div>

          {!editorScreenshot ? (
            <div className="empty-state">
              <h4>Select a screenshot to edit</h4>
              <p>Go to Gallery and click Edit on any screenshot.</p>
            </div>
          ) : (
            <div className="screenshot-editor-stage">
              <div className="screenshot-editor-meta">
                <span className="screenshot-filename" title={editorScreenshot.filename}>{editorScreenshot.filename}</span>
                <span className="screenshot-date">{formatDate(editorScreenshot.date)}</span>
              </div>
              {editorLoading && <div className="screenshot-editor-loading">Loading image...</div>}
              <canvas
                ref={editorCanvasRef}
                className="screenshot-editor-canvas"
                onPointerDown={handleEditorPointerDown}
                onPointerMove={handleEditorPointerMove}
                onPointerUp={(event) => finalizeEditorStroke(event, false)}
                onPointerCancel={(event) => finalizeEditorStroke(event, true)}
              />
            </div>
          )}
        </div>
      ) : activeSubTab === 'timeline' ? (
        <div className="screenshots-timeline">
          {sortedScreenshots.map((ss) => (
            <div
              key={ss.filename}
              className="screenshot-timeline-row"
              onContextMenu={(e) => handleScreenshotContextMenu(e, ss)}
            >
              <button
                type="button"
                className="screenshot-timeline-thumb-btn"
                onClick={() => setSelectedImage(ss)}
              >
                <img src={convertFileSrc(ss.path)} alt={ss.filename} className="screenshot-timeline-thumb" />
              </button>
              <div className="screenshot-timeline-meta">
                <span className="screenshot-filename" title={ss.filename}>{ss.filename}</span>
                <span className="screenshot-date">{formatDate(ss.date)}</span>
              </div>
              <div className="screenshot-timeline-actions">
                <button className="open-btn" onClick={() => setSelectedImage(ss)} title="Open preview">Open</button>
                <button className="edit-btn" onClick={() => handleEditScreenshot(ss)} title="Edit screenshot">Edit</button>
                <button
                  className="timeline-copy-btn"
                  title={copiedId === ss.filename ? 'Copied!' : 'Copy to clipboard'}
                  onClick={() => handleCopy(ss)}
                >
                  {copiedId === ss.filename ? 'Copied' : 'Copy'}
                </button>
                <button className="delete-btn" onClick={() => handleDelete(ss)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="screenshots-grid">
          {screenshots.map((ss) => (
            <div
              key={ss.filename}
              className="screenshot-card"
              onContextMenu={(e) => handleScreenshotContextMenu(e, ss)}
            >
              <div className="screenshot-image-wrapper">
                <img
                  src={convertFileSrc(ss.path)}
                  alt={ss.filename}
                  className="screenshot-image"
                  onClick={() => setSelectedImage(ss)}
                />
                <button
                  className={`copy-screenshot-btn ${copiedId === ss.filename ? 'copied' : ''}`}
                  title={copiedId === ss.filename ? 'Copied!' : 'Copy to clipboard'}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCopy(ss);
                  }}
                >
                  {copiedId === ss.filename ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                  )}
                </button>
              </div>
              <div className="screenshot-info">
                <div className="screenshot-meta">
                  <span className="screenshot-filename">{ss.filename}</span>
                  <span className="screenshot-date">{formatDate(ss.date)}</span>
                </div>
                <div className="screenshot-card-actions">
                  <button className="edit-btn" onClick={() => handleEditScreenshot(ss)}>
                    Edit
                  </button>
                  <button className="delete-btn" onClick={() => handleDelete(ss)}>
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedImage && (
        <div
          className="screenshot-modal"
          onClick={() => setSelectedImage(null)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.9)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '40px',
            zIndex: 1000,
            cursor: 'pointer'
          }}
        >
          <div className="modal-screenshot-info" onClick={e => e.stopPropagation()}>
            <h3>{selectedImage.filename}</h3>
            <span>{formatDate(selectedImage.date)}</span>
          </div>
          <img
            src={convertFileSrc(selectedImage.path)}
            alt={selectedImage.filename}
            className="modal-screenshot-image"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}

      <ConfirmModal
        isOpen={deleteConfirm.show}
        title="Delete Screenshot"
        message={`Are you sure you want to delete "${deleteConfirm.screenshot?.filename}"?`}
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteConfirm({ show: false, screenshot: null })}
      />

      {screenshotContextMenu && createPortal(
        <div
          ref={screenshotContextMenuRef}
          className="screenshot-context-menu"
          style={{
            position: 'fixed',
            left: screenshotContextMenu.x,
            top: screenshotContextMenu.y,
            visibility: screenshotContextMenu.positioned ? 'visible' : 'hidden'
          }}
          onClick={e => e.stopPropagation()}
        >
          <button onClick={() => { setScreenshotContextMenu(null); setSelectedImage(screenshotContextMenu.screenshot); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
            View
          </button>
          <button onClick={() => { setScreenshotContextMenu(null); handleEditScreenshot(screenshotContextMenu.screenshot); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
            Edit
          </button>
          <button onClick={() => { setScreenshotContextMenu(null); handleOpenScreenshot(screenshotContextMenu.screenshot); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
            View with system
          </button>
          <button onClick={() => { setScreenshotContextMenu(null); handleCopy(screenshotContextMenu.screenshot); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            Copy Image
          </button>
          <button onClick={() => {
            setScreenshotContextMenu(null);
            setRenameModal({
              show: true,
              screenshot: screenshotContextMenu.screenshot,
              newName: screenshotContextMenu.screenshot.filename
            });
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
            Rename
          </button>
          <button onClick={() => { setScreenshotContextMenu(null); handleOpenFolder(); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
            Show in Folder
          </button>
          <div className="divider" />
          <button className="danger" onClick={() => { setScreenshotContextMenu(null); handleDelete(screenshotContextMenu.screenshot); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
            Delete
          </button>
        </div>,
        document.body
      )}

      {renameModal.show && (
        <div className="welcome-overlay" onClick={() => setRenameModal({ show: false, screenshot: null, newName: '' })}>
          <div className="rename-modal" onClick={e => e.stopPropagation()}>
            <h3>Rename Screenshot</h3>
            <input
              type="text"
              value={renameModal.newName}
              onChange={e => setRenameModal(prev => ({ ...prev, newName: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && handleRename()}
              autoFocus
            />
            <div className="rename-actions">
              <button className="rename-cancel" onClick={() => setRenameModal({ show: false, screenshot: null, newName: '' })}>Cancel</button>
              <button className="rename-confirm" onClick={handleRename}>Rename</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="notification notification-info" style={{ pointerEvents: 'none' }}>
          {toast}
        </div>
      )}
    </div>
  );
}

export default memo(InstanceScreenshots);
