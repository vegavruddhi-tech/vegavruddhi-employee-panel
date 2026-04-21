import React, { useState, useEffect } from 'react';
import { API_BASE } from '../api';
import { useNavigate, Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

export default function Tasks() {
  const navigate = useNavigate();
  const token = localStorage.getItem('token');
  const [employee, setEmployee] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [filter, setFilter] = useState('pending'); // 'pending', 'completed', 'all'
  const [taskCounts, setTaskCounts] = useState({ pending: 0, completed: 0, total: 0 });
  const [completeModal, setCompleteModal] = useState(null); // { task }
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      navigate('/');
      return;
    }

    // Fetch employee profile
    fetch(`${API_BASE}/api/auth/profile`, {
      headers: { Authorization: 'Bearer ' + token }
    })
      .then(r => {
        if (r.status === 401) {
          localStorage.clear();
          navigate('/');
        }
        return r.json();
      })
      .then(setEmployee)
      .catch(console.error);
  }, [token, navigate]);

  useEffect(() => {
    if (!token) return;
    loadTasks();
    loadTaskCounts();
  }, [token, filter]);

  const loadTasks = () => {
    setLoading(true);
    const url = filter === 'all' 
      ? `${API_BASE}/api/tasks/my-tasks`
      : `${API_BASE}/api/tasks/my-tasks?status=${filter}`;

    fetch(url, {
      headers: { Authorization: 'Bearer ' + token }
    })
      .then(r => r.json())
      .then(data => {
        // Sort tasks: urgent first, then by creation date
        const sortedTasks = (Array.isArray(data) ? data : []).sort((a, b) => {
          // Urgent tasks come first
          if (a.isUrgent && !b.isUrgent) return -1;
          if (!a.isUrgent && b.isUrgent) return 1;
          // Then sort by creation date (newest first)
          return new Date(b.createdAt) - new Date(a.createdAt);
        });
        setTasks(sortedTasks);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  };

  const loadTaskCounts = () => {
    fetch(`${API_BASE}/api/tasks/my-tasks/count`, {
      headers: { Authorization: 'Bearer ' + token }
    })
      .then(r => r.json())
      .then(setTaskCounts)
      .catch(console.error);
  };

  const handleCompleteTask = async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const completionNotes = formData.get('completionNotes');
    const completionProof = formData.get('completionProof');

    try {
      const response = await fetch(`${API_BASE}/api/tasks/${completeModal.task._id}/complete`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token
        },
        body: JSON.stringify({
          completionNotes,
          completionProof // TODO: Handle file upload
        })
      });

      if (response.ok) {
        alert('Task marked as completed!');
        setCompleteModal(null);
        loadTasks();
        loadTaskCounts();
      } else {
        const data = await response.json();
        alert(data.message || 'Failed to complete task');
      }
    } catch (err) {
      alert('Error completing task');
      console.error(err);
    }
  };

  const filteredTasks = tasks;

  return (
    <>
      <Navbar emp={employee} taskCount={taskCounts.pending} />
      <div className="main-content">
        {/* Header */}
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--green-dark)', margin: 0 }}>
            📋 My Tasks
          </h1>
          <p style={{ fontSize: 14, color: 'var(--text-light)', marginTop: 6 }}>
            Tasks assigned by your Team Lead
          </p>
        </div>

        {/* Task Counts */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 100, background: '#fff3e0', padding: '12px 16px', borderRadius: 12, border: '2px solid #ff9800' }}>
            <div style={{ fontSize: 11, color: '#e65100', fontWeight: 700, textTransform: 'uppercase' }}>Pending</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: '#ff9800', marginTop: 4 }}>{taskCounts.pending}</div>
          </div>
          <div style={{ flex: 1, minWidth: 100, background: '#e8f5e9', padding: '12px 16px', borderRadius: 12, border: '2px solid #2e7d32' }}>
            <div style={{ fontSize: 11, color: '#1b5e20', fontWeight: 700, textTransform: 'uppercase' }}>Completed</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: '#2e7d32', marginTop: 4 }}>{taskCounts.completed}</div>
          </div>
          <div style={{ flex: 1, minWidth: 100, background: '#f5f5f5', padding: '12px 16px', borderRadius: 12, border: '2px solid #757575' }}>
            <div style={{ fontSize: 11, color: '#424242', fontWeight: 700, textTransform: 'uppercase' }}>Total</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: '#757575', marginTop: 4 }}>{taskCounts.total}</div>
          </div>
        </div>

        {/* Filter Tabs */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, borderBottom: '2px solid #f0f0f0' }}>
          {[
            { key: 'pending', label: 'Pending', count: taskCounts.pending },
            { key: 'completed', label: 'Completed', count: taskCounts.completed },
            { key: 'all', label: 'All', count: taskCounts.total }
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              style={{
                padding: '10px 20px',
                background: filter === tab.key ? 'var(--green-dark)' : 'transparent',
                color: filter === tab.key ? '#fff' : 'var(--text-mid)',
                border: 'none',
                borderBottom: filter === tab.key ? '3px solid var(--green-dark)' : '3px solid transparent',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
                borderRadius: '8px 8px 0 0',
                transition: 'all 0.2s'
              }}>
              {tab.label} ({tab.count})
            </button>
          ))}
        </div>

        {/* Tasks List */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-light)' }}>
            Loading tasks...
          </div>
        ) : filteredTasks.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-light)' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>📭</div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>No tasks found</div>
            <div style={{ fontSize: 13, marginTop: 6 }}>
              {filter === 'pending' ? 'You have no pending tasks' : 
               filter === 'completed' ? 'You haven\'t completed any tasks yet' :
               'No tasks assigned to you'}
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 16 }}>
            {filteredTasks.map(task => {
              const isPending = task.status === 'pending';
              const statusColor = isPending ? '#ff9800' : '#2e7d32';
              const statusBg = isPending ? '#fff3e0' : '#e8f5e9';
              const isOverdue = task.isUrgent && task.deadline && new Date(task.deadline) < new Date();

              return (
                <div
                  key={task._id}
                  style={{
                    background: '#fff',
                    borderRadius: 12,
                    padding: '16px 20px',
                    border: task.isUrgent ? `3px solid ${isOverdue ? '#d32f2f' : '#ff9800'}` : `2px solid ${statusBg}`,
                    boxShadow: task.isUrgent ? '0 4px 16px rgba(255,152,0,0.2)' : '0 2px 8px rgba(0,0,0,0.06)',
                    position: 'relative'
                  }}>
                  
                  {/* Urgent Badge */}
                  {task.isUrgent && (
                    <div style={{
                      position: 'absolute',
                      top: -10,
                      right: 20,
                      background: isOverdue ? '#d32f2f' : '#ff9800',
                      color: '#fff',
                      padding: '4px 12px',
                      borderRadius: 20,
                      fontSize: 10,
                      fontWeight: 800,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
                    }}>
                      ⚡ URGENT {isOverdue && '• OVERDUE'}
                    </div>
                  )}
                  
                  {/* Header */}
                  <div style={{ display: 'flex', alignItems: 'start', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                        <span style={{
                          background: statusBg,
                          color: statusColor,
                          padding: '3px 10px',
                          borderRadius: 12,
                          fontSize: 10,
                          fontWeight: 800,
                          textTransform: 'uppercase'
                        }}>
                          {isPending ? '⏳ Pending' : '✅ Completed'}
                        </span>
                        {task.isUrgent && task.deadline && (
                          <span style={{
                            background: isOverdue ? '#ffebee' : '#fff3e0',
                            color: isOverdue ? '#d32f2f' : '#e65100',
                            padding: '3px 10px',
                            borderRadius: 12,
                            fontSize: 10,
                            fontWeight: 700
                          }}>
                            📅 Due: {new Date(task.deadline).toLocaleDateString('en-IN')}
                          </span>
                        )}
                        <span style={{ fontSize: 11, color: 'var(--text-light)' }}>
                          Created: {new Date(task.createdAt).toLocaleDateString('en-IN')}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-light)' }}>
                        From: <strong>{task.tlName}</strong>
                      </div>
                    </div>
                  </div>

                  {/* Merchant Info */}
                  <Link
                    to={`/merchant/${task.merchantId}`}
                    style={{
                      textDecoration: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '12px',
                      background: '#f9f9f9',
                      borderRadius: 8,
                      marginBottom: 12
                    }}>
                    <div style={{
                      width: 40,
                      height: 40,
                      borderRadius: '50%',
                      background: 'linear-gradient(135deg, var(--green-dark), var(--green-mid))',
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 16,
                      fontWeight: 800,
                      flexShrink: 0
                    }}>
                      {task.merchantName.charAt(0).toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-dark)' }}>
                        {task.merchantName}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-mid)', marginTop: 2 }}>
                        📞 {task.merchantPhone} • {task.product}
                      </div>
                    </div>
                    <div style={{ fontSize: 16, color: 'var(--text-light)' }}>›</div>
                  </Link>

                  {/* Verification Details */}
                  {task.verificationDetails && task.verificationDetails.status && (
                    <div style={{ 
                      background: '#fff8e1', 
                      border: '1.5px solid #ffb74d', 
                      padding: '10px 12px', 
                      borderRadius: 8, 
                      marginBottom: 12 
                    }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#e65100', marginBottom: 6 }}>
                        🔍 Verification Status: {task.verificationDetails.status}
                      </div>
                      
                      {task.verificationDetails.passedConditions && task.verificationDetails.passedConditions.length > 0 && (
                        <div style={{ marginBottom: 6 }}>
                          <div style={{ fontSize: 9, color: '#2e7d32', fontWeight: 700, marginBottom: 3 }}>✓ Verified:</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {task.verificationDetails.passedConditions.map((cond, i) => (
                              <span key={i} style={{ 
                                background: '#e6f4ea', 
                                color: '#2e7d32', 
                                padding: '2px 6px', 
                                borderRadius: 10, 
                                fontSize: 9, 
                                fontWeight: 600 
                              }}>
                                ✓ {cond}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {task.verificationDetails.failedConditions && task.verificationDetails.failedConditions.length > 0 && (
                        <div>
                          <div style={{ fontSize: 9, color: '#c62828', fontWeight: 700, marginBottom: 3 }}>✗ Pending:</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {task.verificationDetails.failedConditions.map((cond, i) => (
                              <span key={i} style={{ 
                                background: '#fdecea', 
                                color: '#c62828', 
                                padding: '2px 6px', 
                                borderRadius: 10, 
                                fontSize: 9, 
                                fontWeight: 600 
                              }}>
                                ✗ {cond}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Reason */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase', marginBottom: 4 }}>
                      Reason
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-dark)', background: '#fff8e1', padding: '8px 12px', borderRadius: 6, border: '1px solid #ffe082' }}>
                      {task.reason}
                    </div>
                  </div>

                  {/* Instructions */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase', marginBottom: 4 }}>
                      Instructions
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-dark)', background: '#e3f2fd', padding: '8px 12px', borderRadius: 6, border: '1px solid #90caf9' }}>
                      {task.instructions}
                    </div>
                  </div>

                  {/* Completion Info */}
                  {!isPending && task.completionNotes && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase', marginBottom: 4 }}>
                        Your Notes
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--text-dark)', background: '#e8f5e9', padding: '8px 12px', borderRadius: 6, border: '1px solid #a5d6a7', fontStyle: 'italic' }}>
                        "{task.completionNotes}"
                      </div>
                    </div>
                  )}

                  {/* Action Button */}
                  {isPending && (
                    <button
                      onClick={() => setCompleteModal({ task })}
                      style={{
                        width: '100%',
                        padding: '12px',
                        background: 'var(--green-dark)',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 8,
                        fontSize: 14,
                        fontWeight: 700,
                        cursor: 'pointer',
                        marginTop: 8
                      }}>
                      ✅ Mark as Completed
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <Footer />

      {/* Complete Task Modal */}
      {completeModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={e => { if (e.target === e.currentTarget) setCompleteModal(null); }}>
          <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 500, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', overflow: 'hidden' }}>
            <div style={{ padding: '20px 24px', background: 'linear-gradient(135deg, #2e7d32, #1b5e20)', color: '#fff' }}>
              <h3 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>✅ Complete Task</h3>
              <div style={{ fontSize: 12, opacity: 0.9, marginTop: 4 }}>
                {completeModal.task.merchantName}
              </div>
            </div>
            
            <form onSubmit={handleCompleteTask} style={{ padding: '20px 24px' }}>
              {/* Completion Notes */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#333', marginBottom: 6 }}>
                  Completion Notes (Optional)
                </label>
                <textarea
                  name="completionNotes"
                  rows={4}
                  placeholder="Describe what you did to complete this task..."
                  style={{ width: '100%', padding: '10px', border: '2px solid #e0e0e0', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }}
                />
              </div>

              {/* Proof Upload - TODO */}
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#333', marginBottom: 6 }}>
                  Proof/Evidence (Optional)
                </label>
                <input
                  type="text"
                  name="completionProof"
                  placeholder="Image URL or file path (file upload coming soon)"
                  style={{ width: '100%', padding: '10px', border: '2px solid #e0e0e0', borderRadius: 8, fontSize: 13 }}
                />
              </div>

              {/* Buttons */}
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => setCompleteModal(null)}
                  style={{ padding: '10px 20px', background: '#f5f5f5', color: '#666', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{ padding: '10px 20px', background: 'var(--green-dark)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                  Complete Task
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
