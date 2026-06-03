import React, { useState, useEffect } from 'react';
import { API_BASE } from '../api';

export default function MeetingsModal({ isOpen, onClose, userEmail, token }) {
  const [meetings, setMeetings] = useState({ upcoming: [], past: [] });
  const [activeTab, setActiveTab] = useState('upcoming');
  const [joinMeeting, setJoinMeeting] = useState(null); // { meetingLink, title, roomName }
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isOpen && userEmail && token) {
      setLoading(true);
      fetch(`${API_BASE}/api/meetings/my-meetings?email=${encodeURIComponent(userEmail)}`, {
        headers: { Authorization: 'Bearer ' + token }
      })
        .then(r => r.json())
        .then(data => {
          if (data.success) {
            setMeetings(data.meetings || { upcoming: [], past: [] });
          }
          setLoading(false);
        })
        .catch(err => {
          console.error('Failed to fetch meetings:', err);
          setLoading(false);
        });
    }
  }, [isOpen, userEmail, token]);

  const handleJoin = async (meeting) => {
    try {
      // Create personalized meeting link with user's name
      const displayName = encodeURIComponent(userEmail.split('@')[0] || 'Guest');
      
      // Fetch JWT token for JaaS
      const res = await fetch(`${API_BASE}/api/meetings/jaas-jwt?name=${displayName}&email=${encodeURIComponent(userEmail)}`);
      const data = await res.json();
      
      if (!data.token) throw new Error('No token received');
      
      let baseLink = meeting.meetingLink;
      if (baseLink.includes('meet.jit.si')) {
        baseLink = baseLink.replace('meet.jit.si', '8x8.vc/vpaas-magic-cookie-85bbd4a4745d48878a0d7c667dd963fe');
      }
      
      const personalizedLink = `${baseLink}?jwt=${data.token}#userInfo.displayName="${displayName}"&config.prejoinPageEnabled=false`;
      
      setJoinMeeting({
        meetingLink: personalizedLink,
        title: meeting.title,
        roomName: meeting.roomName
      });
    } catch (err) {
      console.error('Failed to authenticate meeting room:', err);
      alert('Failed to get secure meeting token. Please try again.');
    }
  };

  const handleLeaveMeeting = () => {
    setJoinMeeting(null);
  };

  if (!isOpen) return null;

  // If joining a meeting, show full-screen Jitsi iframe
  if (joinMeeting) {
    return (
      <div style={{
        position: 'fixed',
        inset: 0,
        background: '#000',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column'
      }}>
        {/* Meeting Header */}
        <div style={{
          padding: '12px 20px',
          background: 'linear-gradient(135deg, #1a4731 0%, #2e7d32 100%)',
          color: 'white',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
        }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
              🎥 {joinMeeting.title}
            </h3>
            <p style={{ margin: '4px 0 0 0', fontSize: 11, opacity: 0.9 }}>
              Room: {joinMeeting.roomName}
            </p>
          </div>
          <button
            onClick={handleLeaveMeeting}
            style={{
              background: '#c62828',
              color: 'white',
              border: 'none',
              padding: '10px 20px',
              borderRadius: 8,
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              transition: 'all 0.2s',
              boxShadow: '0 2px 8px rgba(198, 40, 40, 0.3)'
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = '#b71c1c';
              e.currentTarget.style.transform = 'scale(1.05)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = '#c62828';
              e.currentTarget.style.transform = 'scale(1)';
            }}
          >
            <span>✕</span>
            <span>Leave Meeting</span>
          </button>
        </div>

        {/* Jitsi iframe */}
        <iframe
          src={joinMeeting.meetingLink}
          allow="camera; microphone; fullscreen; display-capture; autoplay; clipboard-write"
          allowFullScreen
          style={{
            flex: 1,
            border: 'none',
            width: '100%',
            height: '100%'
          }}
          title={joinMeeting.title}
        />
      </div>
    );
  }

  // Meetings list modal
  return (
    <>
      {/* Backdrop */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.5)',
          zIndex: 1000,
          animation: 'fadeIn 0.2s ease'
        }}
        onClick={onClose}
      />

      {/* Modal */}
      <div style={{
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        background: 'white',
        borderRadius: 16,
        width: '90%',
        maxWidth: 600,
        maxHeight: '85vh',
        zIndex: 1001,
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        animation: 'slideUp 0.3s ease'
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 24px',
          background: 'linear-gradient(135deg, #1a4731 0%, #2e7d32 100%)',
          color: 'white',
          borderRadius: '16px 16px 0 0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>
              🔔 Meeting Notifications
            </h2>
            <p style={{ margin: '4px 0 0 0', fontSize: 13, opacity: 0.9 }}>
              {meetings.upcoming.length} upcoming · {meetings.past.length} past
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.2)',
              border: 'none',
              color: 'white',
              width: 36,
              height: 36,
              borderRadius: '50%',
              cursor: 'pointer',
              fontSize: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s'
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.3)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.2)'}
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div style={{
          display: 'flex',
          borderBottom: '2px solid #e0e0e0',
          background: '#f5f5f5'
        }}>
          <button
            onClick={() => setActiveTab('upcoming')}
            style={{
              flex: 1,
              padding: '14px',
              border: 'none',
              background: activeTab === 'upcoming' ? '#fff' : 'transparent',
              color: activeTab === 'upcoming' ? '#1a4731' : '#666',
              fontWeight: 700,
              fontSize: 14,
              cursor: 'pointer',
              borderBottom: activeTab === 'upcoming' ? '3px solid #2e7d32' : '3px solid transparent',
              transition: 'all 0.2s',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8
            }}
          >
            <span>📅</span>
            <span>Upcoming ({meetings.upcoming.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('past')}
            style={{
              flex: 1,
              padding: '14px',
              border: 'none',
              background: activeTab === 'past' ? '#fff' : 'transparent',
              color: activeTab === 'past' ? '#1a4731' : '#666',
              fontWeight: 700,
              fontSize: 14,
              cursor: 'pointer',
              borderBottom: activeTab === 'past' ? '3px solid #2e7d32' : '3px solid transparent',
              transition: 'all 0.2s',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8
            }}
          >
            <span>📜</span>
            <span>Past ({meetings.past.length})</span>
          </button>
        </div>

        {/* Meeting List */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '20px',
          background: '#fafafa'
        }}>
          {loading ? (
            <div style={{
              textAlign: 'center',
              padding: '60px 20px',
              color: '#999'
            }}>
              <div style={{ fontSize: 40, marginBottom: 16 }}>⏳</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Loading meetings...</div>
            </div>
          ) : (activeTab === 'upcoming' ? meetings.upcoming : meetings.past).length === 0 ? (
            <div style={{
              textAlign: 'center',
              padding: '60px 20px',
              color: '#999'
            }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>
                {activeTab === 'upcoming' ? '📭' : '📂'}
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#666', marginBottom: 8 }}>
                No {activeTab} meetings
              </div>
              <div style={{ fontSize: 13 }}>
                {activeTab === 'upcoming' 
                  ? 'You don\'t have any upcoming meetings scheduled'
                  : 'No past meetings to show'}
              </div>
            </div>
          ) : (
            (activeTab === 'upcoming' ? meetings.upcoming : meetings.past).map(meeting => {
              const meetingTime = new Date(meeting.scheduledDateTime);
              const isUpcoming = meetingTime > new Date();
              const isPast = !isUpcoming;
              const isInstant = meeting.isInstant; // Flag from backend
              
              // Format date and time
              const formattedDate = meetingTime.toLocaleDateString('en-IN', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
              });
              
              const formattedTime = meetingTime.toLocaleTimeString('en-IN', {
                hour: '2-digit',
                minute: '2-digit'
              });
              
              // Check if meeting is happening soon (within 10 minutes) - only for scheduled meetings
              const minutesUntil = Math.floor((meetingTime - new Date()) / 60000);
              const isStartingSoon = !isInstant && minutesUntil >= 0 && minutesUntil <= 10;
              
              return (
                <div
                  key={meeting._id}
                  style={{
                    border: isInstant ? '2px solid #4caf50' : isStartingSoon ? '2px solid #ff9800' : '1px solid #e0e0e0',
                    borderRadius: 12,
                    padding: '16px 20px',
                    marginBottom: '12px',
                    background: meeting.status === 'completed' ? '#f5f5f5' : isInstant ? '#e8f5e9' : isStartingSoon ? '#fff8e1' : '#fff',
                    boxShadow: isInstant ? '0 4px 12px rgba(76, 175, 80, 0.3)' : isStartingSoon ? '0 4px 12px rgba(255, 152, 0, 0.2)' : '0 2px 8px rgba(0,0,0,0.08)',
                    transition: 'all 0.2s',
                    position: 'relative'
                  }}
                  onMouseEnter={e => {
                    if (meeting.status === 'scheduled') {
                      e.currentTarget.style.transform = 'translateY(-2px)';
                      e.currentTarget.style.boxShadow = '0 6px 16px rgba(0,0,0,0.15)';
                    }
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = isInstant ? '0 4px 12px rgba(76, 175, 80, 0.3)' : isStartingSoon ? '0 4px 12px rgba(255, 152, 0, 0.2)' : '0 2px 8px rgba(0,0,0,0.08)';
                  }}
                >
                  {meeting.status === 'live' && (
                    <div style={{
                      position: 'absolute',
                      top: -10,
                      right: 16,
                      background: '#4caf50',
                      color: 'white',
                      padding: '4px 12px',
                      borderRadius: 12,
                      fontSize: 11,
                      fontWeight: 800,
                      boxShadow: '0 2px 8px rgba(76, 175, 80, 0.4)',
                      animation: 'pulse 2s infinite'
                    }}>
                      🔴 LIVE NOW
                    </div>
                  )}
                  
                  {isStartingSoon && !isInstant && meeting.status === 'scheduled' && (
                    <div style={{
                      position: 'absolute',
                      top: -10,
                      right: 16,
                      background: '#ff9800',
                      color: 'white',
                      padding: '4px 12px',
                      borderRadius: 12,
                      fontSize: 11,
                      fontWeight: 800,
                      boxShadow: '0 2px 8px rgba(255, 152, 0, 0.4)'
                    }}>
                      🔔 STARTING IN {minutesUntil} MIN
                    </div>
                  )}
                  
                  <h3 style={{
                    margin: '0 0 12px 0',
                    color: meeting.status === 'completed' ? '#666' : '#1a3b2a',
                    fontSize: 16,
                    fontWeight: 800,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8
                  }}>
                    <span>{meeting.status === 'completed' ? '✅' : meeting.status === 'live' ? '🔴' : '🎥'}</span>
                    <span>{meeting.title}</span>
                  </h3>
                  
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    marginBottom: 12
                  }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: 13,
                      color: '#555'
                    }}>
                      <span>📅</span>
                      <span style={{ fontWeight: 600 }}>{formattedDate}</span>
                    </div>
                    
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: 13,
                      color: '#555'
                    }}>
                      <span>🕐</span>
                      <span style={{ fontWeight: 600 }}>{formattedTime}</span>
                      <span style={{
                        background: '#e8f5e9',
                        color: '#2e7d32',
                        padding: '2px 8px',
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 700
                      }}>
                        {meeting.duration} min
                      </span>
                    </div>
                  </div>
                  
                  {(meeting.status === 'scheduled' || meeting.status === 'live') && (
                    <button
                      onClick={() => handleJoin(meeting)}
                      style={{
                        width: '100%',
                        marginTop: '4px',
                        background: meeting.status === 'live'
                          ? 'linear-gradient(135deg, #4caf50 0%, #2e7d32 100%)'
                          : isStartingSoon 
                            ? 'linear-gradient(135deg, #ff9800 0%, #f57c00 100%)'
                            : 'linear-gradient(135deg, #2e7d32 0%, #1a4731 100%)',
                        color: 'white',
                        border: 'none',
                        padding: '12px 20px',
                        borderRadius: 8,
                        fontWeight: 700,
                        fontSize: 14,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                        transition: 'all 0.2s',
                        boxShadow: '0 4px 12px rgba(46, 125, 50, 0.3)'
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.transform = 'scale(1.02)';
                        e.currentTarget.style.boxShadow = '0 6px 16px rgba(46, 125, 50, 0.4)';
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.transform = 'scale(1)';
                        e.currentTarget.style.boxShadow = '0 4px 12px rgba(46, 125, 50, 0.3)';
                      }}
                    >
                      <span style={{ fontSize: 18 }}>🎥</span>
                      <span>{meeting.status === 'live' ? 'Join Live Meeting' : isStartingSoon ? 'Join Now!' : 'Join Meeting'}</span>
                    </button>
                  )}
                  
                  {meeting.status === 'completed' && (
                    <div style={{
                      padding: '8px 12px',
                      background: '#f0f0f0',
                      borderRadius: 6,
                      fontSize: 12,
                      color: '#666',
                      textAlign: 'center',
                      fontWeight: 600
                    }}>
                      ✓ Meeting Completed
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* CSS animations */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        
        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translate(-50%, -45%);
          }
          to {
            opacity: 1;
            transform: translate(-50%, -50%);
          }
        }
        
        @keyframes pulse {
          0%, 100% {
            opacity: 1;
            transform: scale(1);
          }
          50% {
            opacity: 0.8;
            transform: scale(1.05);
          }
        }
      `}</style>
    </>
  );
}
