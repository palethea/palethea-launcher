import { useState, useEffect } from 'react';
import { X, Check, Search, ListFilterPlus } from 'lucide-react';
import './FilterModal.css';

function FilterModal({ isOpen, onClose, categories, selectedCategories, onApply, title = "Select Filters" }) {
  const [currentSelected, setCurrentSelected] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (isOpen) {
      setCurrentSelected(selectedCategories || []);
      setSearchTerm('');
    }
  }, [isOpen, selectedCategories]);

  if (!isOpen) return null;

  const toggleCategory = (id, isSection) => {
    if (isSection) return;
    setCurrentSelected(prev => 
      prev.includes(id) 
        ? prev.filter(item => item !== id) 
        : [...prev, id]
    );
  };

  const filteredCategories = categories.filter(cat => 
    cat.id !== 'all' && (cat.isSection || cat.label.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  // Filter out sections that have no children matching the search
  const displayedCategories = searchTerm 
    ? filteredCategories.filter((cat, index) => {
        if (!cat.isSection) return true;
        // Check if next items until next section contain any result
        const nextItems = filteredCategories.slice(index + 1);
        const nextSectionIndex = nextItems.findIndex(i => i.isSection);
        const children = nextSectionIndex === -1 ? nextItems : nextItems.slice(0, nextSectionIndex);
        return children.some(c => !c.isSection);
      })
    : filteredCategories;

  const handleApply = () => {
    onApply(currentSelected);
    onClose();
  };

  const handleClear = () => {
    setCurrentSelected([]);
  };

  return (
    <div className="filter-overlay" onClick={onClose}>
      <div className="filter-modal" onClick={(e) => e.stopPropagation()}>
        <div className="filter-header">
          <div className="filter-header-left">
            <ListFilterPlus size={20} className="header-icon" />
            <h3>{title}</h3>
          </div>
          <button className="close-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="filter-search">
          <Search size={16} className="search-icon-modal" />
          <input 
            type="text" 
            placeholder="Search categories..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            autoFocus
          />
        </div>

        <div className="filter-body">
          <div className="category-grid-modal">
            {displayedCategories.map(cat => (
              <div 
                key={cat.id} 
                className={`category-item-modal ${cat.isSection ? 'section-header-modal' : ''} ${cat.isSubcategory ? 'subcategory-modal' : ''} ${currentSelected.includes(cat.id) ? 'selected' : ''}`}
                onClick={() => toggleCategory(cat.id, cat.isSection)}
              >
                <span className="cat-label">{cat.label}</span>
                {!cat.isSection && (
                  <div className="cat-checkbox">
                    {currentSelected.includes(cat.id) && <Check size={14} />}
                  </div>
                )}
              </div>
            ))}
            {displayedCategories.length === 0 && (
              <div className="no-filters-found">No categories match your search.</div>
            )}
          </div>
        </div>

        <div className="filter-footer">
          <button className="clear-btn" onClick={handleClear}>Clear All</button>
          <div className="footer-actions">
            <button className="cancel-btn modal-cancel" onClick={onClose}>Cancel</button>
            <button className="apply-btn modal-apply" onClick={handleApply}>
              Apply {currentSelected.length > 0 && `(${currentSelected.length})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default FilterModal;
