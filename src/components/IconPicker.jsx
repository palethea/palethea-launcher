import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { join } from '@tauri-apps/api/path';
import { X, Upload, Image as ImageIcon, Trash2 } from 'lucide-react';
import './IconPicker.css';

const STOCK_ICONS = [
  'Acacia_Boat', 'Allium', 'Amethyst_Cluster', 'Bone', 'Book', 'Bow', 
  'Carrot', 'Carrot_On_A_Stick', 'Cherry_Sapling', 'Creeper_Head', 
  'creeper_spawn_egg', 'Dragon_Head', 'Milk_Bucket', 'Netherite_Pickaxe', 
  'Piglin_Head', 'Skeleton_Skull', 'skeleton_spawn_egg', 
  'Wither_Skeleton_Skull', 'Zombie_Head'
];

function IconPicker({ onClose, onSelect, currentIcon, instanceId }) {
  const [activeTab, setActiveTab] = useState('stock');
  const [loading, setLoading] = useState(false);
  const [stockIconUrls, setStockIconUrls] = useState({});

  useEffect(() => {
    let cancelled = false;
    const loadStockUrls = async () => {
      try {
        const baseDir = await invoke('get_data_directory');
        const urls = {};
        for (const icon of STOCK_ICONS) {
          const path = await join(baseDir, 'instance_logos', `${icon}.png`);
          urls[icon] = convertFileSrc(path);
        }
        if (!cancelled) {
          setStockIconUrls(urls);
        }
      } catch (error) {
        console.error('Failed to load stock icon URLs:', error);
      }
    };
    loadStockUrls();
    return () => { cancelled = true; };
  }, []);

  const handleSelectStock = useCallback((icon) => {
    onSelect(icon, 'stock');
    onClose();
  }, [onSelect, onClose]);

  const handleCustomUpload = useCallback(async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{
          name: 'Images',
          extensions: ['png', 'jpg', 'jpeg', 'webp']
        }]
      });

      if (selected) {
        setLoading(true);
        // We'll let the parent or a dedicated command handle the actual copy/process
        onSelect(selected, 'custom');
        onClose();
      }
    } catch (error) {
      console.error('Failed to select custom icon:', error);
    } finally {
      setLoading(false);
    }
  }, [onSelect, onClose]);

  const handleClear = useCallback(() => {
    onSelect(null, 'clear');
    onClose();
  }, [onSelect, onClose]);

  // Prevent click propagation to close background
  const handleContentClick = (e) => e.stopPropagation();

  return (
    <div className="icon-picker-overlay" onClick={onClose}>
      <div className="icon-picker-content" onClick={handleContentClick}>
        <div className="icon-picker-header">
          <h3>Change Instance Icon</h3>
          <button className="icon-picker-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="icon-picker-tabs">
          <button 
            className={`icon-picker-tab ${activeTab === 'stock' ? 'active' : ''}`}
            onClick={() => setActiveTab('stock')}
          >
            <ImageIcon size={16} />
            Stock Icons
          </button>
          <button 
            className={`icon-picker-tab ${activeTab === 'custom' ? 'active' : ''}`}
            onClick={() => setActiveTab('custom')}
          >
            <Upload size={16} />
            Custom Image
          </button>
        </div>

        <div className="icon-picker-body">
          {activeTab === 'stock' ? (
            <div className="stock-icons-grid">
              {STOCK_ICONS.map(icon => (
                <button 
                  key={icon}
                  className={`stock-icon-btn ${currentIcon === `${icon}.png` ? 'selected' : ''}`}
                  onClick={() => handleSelectStock(`${icon}.png`)}
                  title={icon.replace(/_/g, ' ')}
                >
                   {stockIconUrls[icon] ? (
                     <img src={stockIconUrls[icon]} alt={icon} />
                   ) : (
                     <span className="stock-icon-label">{icon.substring(0, 1).toUpperCase()}</span>
                   )}
                </button>
              ))}
            </div>
          ) : (
            <div className="custom-icon-upload">
              <div className="upload-placeholder">
                <Upload size={48} />
                <p>Upload a PNG or JPG to use as instance icon</p>
                <button 
                  className="upload-btn" 
                  onClick={handleCustomUpload}
                  disabled={loading}
                >
                  {loading ? 'Processing...' : 'Choose File'}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="icon-picker-footer">
          <button className="clear-icon-btn" onClick={handleClear}>
            <Trash2 size={16} />
            Reset to Default
          </button>
        </div>
      </div>
    </div>
  );
}

export default IconPicker;
