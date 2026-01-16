import { useState, useEffect, useRef } from 'react';
import { draftsAPI } from '../utils/api';

export default function DraftManager({ draft, onDraftLoad, user }) {
  const fileInputRef = useRef(null);
  const [drafts, setDrafts] = useState([]);
  const [loading, setLoading] = useState(false);

  // Load drafts list when user is authenticated
  useEffect(() => {
    if (user) {
      loadDraftsList();
    }
  }, [user]);

  const loadDraftsList = async () => {
    if (!user) return;

    setLoading(true);
    try {
      const draftsList = await draftsAPI.listDrafts();
      setDrafts(draftsList);
    } catch (error) {
      console.error('Error loading drafts:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = () => {
    if (!draft || !draft.tweets || draft.tweets.length === 0) {
      alert('No draft to save');
      return;
    }

    // If user is logged in, save is handled by auto-save in App.jsx
    // This button is for downloading as backup
    const dataStr = JSON.stringify(draft, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `x-thread-draft-${draft.title || 'untitled'}-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleLoadFromBackend = async (title) => {
    try {
      const loadedDraft = await draftsAPI.getDraftByTitle(title);
      if (loadedDraft && loadedDraft.content) {
        onDraftLoad({
          title: loadedDraft.title,
          createdAt: loadedDraft.createdAt,
          tweets: loadedDraft.content.tweets || []
        });
      }
    } catch (error) {
      console.error('Error loading draft:', error);
      alert('Failed to load draft: ' + error.message);
    }
  };

  const handleLoad = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const loadedDraft = JSON.parse(event.target.result);
        if (loadedDraft.tweets && Array.isArray(loadedDraft.tweets)) {
          onDraftLoad(loadedDraft);
        } else {
          alert('Invalid draft file format');
        }
      } catch (error) {
        alert('Error loading draft file: ' + error.message);
      }
    };
    reader.readAsText(file);
    e.target.value = ''; // Reset input
  };

  return (
    <div className="draft-manager">
      <h2>Draft Management</h2>

      {user && (
        <div className="drafts-list">
          <h3>Your Drafts</h3>
          {loading ? (
            <p>Loading drafts...</p>
          ) : drafts.length === 0 ? (
            <p>No saved drafts yet.</p>
          ) : (
            <ul className="drafts-list-items">
              {drafts.map((d) => (
                <li key={d.id} className="draft-item">
                  <button
                    onClick={() => handleLoadFromBackend(d.title)}
                    className="draft-item-button"
                  >
                    <strong>{d.title}</strong>
                    <span className="draft-meta">
                      {new Date(d.updatedAt).toLocaleDateString()}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="draft-actions">
        <button onClick={handleSave} className="btn btn-primary">
          💾 Download Draft
        </button>
        <button onClick={handleLoad} className="btn btn-secondary">
          📂 Load from File
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />
      </div>
      {draft && (
        <div className="draft-info">
          <p><strong>Title:</strong> {draft.title || 'Untitled'}</p>
          <p><strong>Created:</strong> {draft.createdAt ? new Date(draft.createdAt).toLocaleString() : 'Unknown'}</p>
          <p><strong>Tweets:</strong> {draft.tweets?.length || 0}</p>
          <p className="autosave-indicator">
            <span className="autosave-icon">💾</span>
            <strong>Auto-save:</strong> {user ? 'Enabled (saves to cloud)' : 'Enabled (local only)'}
          </p>
        </div>
      )}
    </div>
  );
}
