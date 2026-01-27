import React, { useState, useEffect, useRef, useCallback } from 'react';
import './CustomColorPicker.css';

const CustomColorPicker = ({ value, onChange }) => {
  const [hue, setHue] = useState(0);
  const [sat, setSat] = useState(100);
  const [val, setVal] = useState(100);
  const [tempHex, setTempHex] = useState(value);
  const satValRef = useRef(null);
  const hueRef = useRef(null);

  // Hex to HSV
  const hexToHsv = useCallback((hex) => {
    let r = 0, g = 0, b = 0;
    if (hex.length === 4) {
      r = parseInt(hex[1] + hex[1], 16);
      g = parseInt(hex[2] + hex[2], 16);
      b = parseInt(hex[3] + hex[3], 16);
    } else if (hex.length === 7) {
      r = parseInt(hex.substring(1, 3), 16);
      g = parseInt(hex.substring(3, 5), 16);
      b = parseInt(hex.substring(5, 7), 16);
    }

    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, v = max;
    const d = max - min;
    s = max === 0 ? 0 : d / max;

    if (max === min) {
      h = 0;
    } else {
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
        default: h = 0;
      }
      h /= 6;
    }
    return { h: h * 360, s: s * 100, v: v * 100 };
  }, []);

  // HSV to Hex
  const hsvToHex = useCallback((h, s, v) => {
    h /= 360; s /= 100; v /= 100;
    let r, g, b;
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);

    switch (i % 6) {
      case 0: r = v; g = t; b = p; break;
      case 1: r = q; g = v; b = p; break;
      case 2: r = p; g = v; b = t; break;
      case 3: r = p; g = q; b = v; break;
      case 4: r = t; g = p; b = v; break;
      case 5: r = v; g = p; b = q; break;
      default: r = 0; g = 0; b = 0;
    }

    const toHex = (x) => {
      const hex = Math.round(x * 255).toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    };
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
  }, []);

  useEffect(() => {
    const { h, s, v } = hexToHsv(value);
    setHue(h);
    setSat(s);
    setVal(v);
    setTempHex(value);
  }, [value, hexToHsv]);

  const handleSatValChange = useCallback((e) => {
    if (!satValRef.current) return;
    const rect = satValRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));
    
    const newSat = x * 100;
    const newVal = y * 100;
    setSat(newSat);
    setVal(newVal);
    onChange(hsvToHex(hue, newSat, newVal));
  }, [hue, onChange, hsvToHex]);

  const handleHueChange = useCallback((e) => {
    if (!hueRef.current) return;
    const rect = hueRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const newHue = x * 360;
    setHue(newHue);
    onChange(hsvToHex(newHue, sat, val));
  }, [sat, val, onChange, hsvToHex]);

  const startDragging = useCallback((handler) => (e) => {
    handler(e);
    const onMouseMove = (moveEvent) => handler(moveEvent);
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  return (
    <div className="custom-color-picker">
      <div 
        className="sat-val-container" 
        ref={satValRef}
        style={{ backgroundColor: `hsl(${hue}, 100%, 50%)` }}
        onMouseDown={startDragging(handleSatValChange)}
      >
        <div className="sat-gradient">
          <div className="val-gradient" />
        </div>
        <div 
          className="picker-handle" 
          style={{ 
            left: `${sat}%`, 
            bottom: `${val}%`,
            backgroundColor: value
          }} 
        />
      </div>
      
      <div 
        className="hue-slider" 
        ref={hueRef}
        onMouseDown={startDragging(handleHueChange)}
      >
        <div 
          className="hue-handle" 
          style={{ left: `${(hue / 360) * 100}%` }} 
        />
      </div>

      <div className="color-picker-footer">
        <div className="color-preview" style={{ backgroundColor: value }} />
        <input 
          type="text" 
          className="hex-input"
          value={tempHex}
          onChange={(e) => {
            const val = e.target.value;
            setTempHex(val);
            if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
              onChange(val);
            }
          }}
          onBlur={() => setTempHex(value)}
        />
      </div>
    </div>
  );
};

export default CustomColorPicker;
