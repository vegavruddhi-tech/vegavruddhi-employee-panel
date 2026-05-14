import React, { useState, useEffect } from 'react';
import {
  Box, Typography, Card, CardContent, CircularProgress, Chip,
  Tooltip, IconButton, Collapse, Button, Alert
} from '@mui/material';
import { BRAND } from '../theme';

const EMP_API = process.env.REACT_APP_EMPLOYEE_API_URL || 'http://localhost:4000/api';

// Global state to track if ANY timeline is expanded
let globalTimelineExpanded = false;
const timelineListeners = new Set();

const notifyTimelineChange = (isExpanded) => {
  globalTimelineExpanded = isExpanded;
  timelineListeners.forEach(listener => listener(isExpanded));
};

// Month names for display
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

// Status colors
const STATUS_COLORS = {
  'Fully Verified': { bg: '#e6f4ea', color: '#2e7d32', icon: '✓', emoji: '🟢' },
  'Partially Done': { bg: '#fff8e1', color: '#f57f17', icon: '◑', emoji: '🟡' },
  'Not Verified':   { bg: '#fdecea', color: '#c62828', icon: '✗', emoji: '🔴' },
  'Not Found':      { bg: '#f5f5f5', color: '#888',    icon: '–', emoji: '⚪' },
};

// Priority Pass colors
const PASS_COLORS = {
  'Active':   { bg: '#e3f2fd', color: '#1565c0', icon: '✅', label: 'Active' },
  'Inactive': { bg: '#fdecea', color: '#c62828', icon: '❌', label: 'Not Active' },
  'Alert':    { bg: '#fff3e0', color: '#e65100', icon: '⚠️', label: 'No Data' },
};

/**
 * TideMerchantTimeline Component
 * Shows month-by-month verification status and Priority Pass Pro status for a Tide merchant
 */
function TideMerchantTimeline({ phone, customerName, inline = false }) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [timeline, setTimeline] = useState(null);
  const [error, setError] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [anyTimelineOpen, setAnyTimelineOpen] = useState(false);

  // Listen to global timeline state changes
  useEffect(() => {
    const listener = (isExpanded) => {
      setAnyTimelineOpen(isExpanded);
    };
    timelineListeners.add(listener);
    return () => {
      timelineListeners.delete(listener);
    };
  }, []);

  // Cleanup body class on unmount
  useEffect(() => {
    return () => { document.body.classList.remove('timeline-open'); };
  }, []);

  const fetchTimeline = async () => {
    if (timeline) return; // Already loaded
    
    setLoading(true);
    setError(null);
    
    try {
      const res = await fetch(`${EMP_API}/tide/merchant-timeline?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(customerName)}`);
      
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      
      const data = await res.json();
      setTimeline(data);
      // Auto-select current month
      const currentMonthName = new Date().toLocaleString('en-US', { month: 'long' });
      setSelectedMonth(currentMonthName);
    } catch (err) {
      console.error('Timeline fetch error:', err);
      setError(err.message || 'Failed to load timeline');
    } finally {
      setLoading(false);
    }
  };

  const toggleTimeline = () => {
    const newExpanded = !expanded;
    setExpanded(newExpanded);
    
    // Notify all timeline instances about the state change
    notifyTimelineChange(newExpanded);
    
    if (newExpanded) {
      document.body.classList.add('timeline-open');
      if (!timeline) fetchTimeline();
    } else {
      document.body.classList.remove('timeline-open');
    }
  };

  // Get current month index (0-11)
  const currentMonthIndex = new Date().getMonth();
  
  // Get selected month data
  const selectedMonthData = timeline?.timeline?.find(m => m.month === selectedMonth);

  return (
    <>
      <Box className="timeline-btn-wrapper" sx={{ 
        position: 'relative',
        visibility: anyTimelineOpen ? 'hidden' : 'visible',
        pointerEvents: anyTimelineOpen ? 'none' : 'auto',
        display: 'inline-flex'
      }}>
        {/* Timeline Toggle Button */}
        <Tooltip title="Show Month-by-Month Timeline" placement="left">
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              toggleTimeline();
            }}
            sx={{
              color: '#1565c0',
              bgcolor: '#e3f2fd',
              border: `1.5px solid #1565c0`,
              '&:hover': {
                bgcolor: '#bbdefb',
                transform: 'scale(1.05)'
              },
              transition: 'all 0.2s'
            }}
          >
            📊
          </IconButton>
        </Tooltip>
      </Box>

      {/* Backdrop */}
      {expanded && (
        <Box
          onClick={toggleTimeline}
          sx={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            bgcolor: 'rgba(0, 0, 0, 0.7)',
            zIndex: 99999,
            backdropFilter: 'blur(2px)',
            pointerEvents: 'all'
          }}
        />
      )}

      {/* Timeline Content */}
      {expanded && (
        <Card 
          onClick={(e) => e.stopPropagation()}
          sx={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: { xs: '100%', sm: '90%' },
            maxWidth: { xs: '100%', sm: 900 },
            height: { xs: '100vh', sm: 'auto' },
            maxHeight: { xs: '100vh', sm: '90vh' },
            overflow: 'auto',
            border: `3px solid ${BRAND.primary}`,
            borderRadius: { xs: 0, sm: 3 },
            bgcolor: '#ffffff',
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
            zIndex: 100000
          }}>
          {/* Close Button */}
          <IconButton
            onClick={toggleTimeline}
            sx={{
              position: 'absolute',
              top: 8,
              right: 8,
              color: '#fff',
              bgcolor: 'rgba(0,0,0,0.2)',
              zIndex: 1,
              '&:hover': { bgcolor: 'rgba(0,0,0,0.3)' }
            }}
          >
            ✕
          </IconButton>
          
          <Box sx={{
            background: `linear-gradient(135deg, ${BRAND.primary}dd, ${BRAND.primary}88)`,
            px: { xs: 2, sm: 2.5 },
            py: { xs: 2, sm: 1.5 },
            color: '#fff'
          }}>
            <Typography variant="subtitle1" sx={{ 
              fontWeight: 800, 
              display: 'flex', 
              alignItems: 'center', 
              gap: 1, 
              color: '#fff',
              fontSize: { xs: '0.95rem', sm: '1rem' },
              pr: 4
            }}>
              📅 Merchant Timeline — {customerName}
            </Typography>
            <Typography variant="caption" sx={{ 
              opacity: 0.9, 
              color: '#fff',
              fontSize: { xs: '0.7rem', sm: '0.75rem' },
              display: 'block',
              mt: 0.5
            }}>
              Phone: {phone} · Verification & Priority Pass Pro Status (2026)
            </Typography>
          </Box>

          <CardContent sx={{ p: { xs: 1.5, sm: 2.5 } }}>
            {loading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 4, gap: 2 }}>
                <CircularProgress size={24} sx={{ color: BRAND.primary }} />
                <Typography variant="body2" color="text.secondary">Loading timeline data...</Typography>
              </Box>
            ) : error ? (
              <Box sx={{ textAlign: 'center', py: 3 }}>
                <Typography variant="body2" color="error" sx={{ mb: 1 }}>⚠️ {error}</Typography>
                <Typography variant="caption" color="text.secondary">
                  Unable to load timeline. Please try again later.
                </Typography>
              </Box>
            ) : !timeline ? (
              <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 3 }}>
                No timeline data available
              </Typography>
            ) : (
              <Box>
                {/* Month Buttons */}
                <Box sx={{ mb: 3 }}>
                  <Typography variant="caption" sx={{ 
                    fontWeight: 700, 
                    color: 'text.secondary', 
                    mb: 1.5, 
                    display: 'block', 
                    textTransform: 'uppercase', 
                    letterSpacing: 1,
                    fontSize: { xs: '0.65rem', sm: '0.75rem' }
                  }}>
                    📅 Select Month to View Details
                  </Typography>
                  <Box sx={{ 
                    display: 'grid', 
                    gridTemplateColumns: { xs: 'repeat(6, 1fr)', sm: 'repeat(12, 1fr)' }, 
                    gap: { xs: 0.5, sm: 0.8 }
                  }}>
                    {timeline.timeline.map((month, idx) => {
                      const isCurrentMonth = idx === currentMonthIndex;
                      const isSelected = selectedMonth === month.month;
                      const statusInfo = STATUS_COLORS[month.status] || STATUS_COLORS['Not Found'];
                      
                      // Determine button color based on status
                      let buttonColor, buttonBg;
                      if (month.status === 'Fully Verified') {
                        buttonColor = '#2e7d32';
                        buttonBg = '#e6f4ea';
                      } else if (month.status === 'Partially Done') {
                        buttonColor = '#f57f17';
                        buttonBg = '#fff8e1';
                      } else if (month.status === 'Not Verified') {
                        buttonColor = '#c62828';
                        buttonBg = '#fdecea';
                      } else {
                        buttonColor = '#888';
                        buttonBg = '#f5f5f5';
                      }
                      
                      return (
                        <Button
                          key={month.monthKey}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedMonth(month.month);
                          }}
                          variant={isSelected ? 'contained' : 'outlined'}
                          sx={{
                            minWidth: 0,
                            p: { xs: 1, sm: 1.5 },
                            borderRadius: 2,
                            border: `2px solid ${isSelected ? BRAND.primary : buttonColor}`,
                            bgcolor: isSelected ? BRAND.primary : buttonBg,
                            color: isSelected ? '#fff' : buttonColor,
                            fontWeight: 800,
                            fontSize: { xs: 9, sm: 11 },
                            textTransform: 'uppercase',
                            outline: isCurrentMonth ? `3px solid ${BRAND.primary}40` : 'none',
                            outlineOffset: 2,
                            transition: 'all 0.2s',
                            '&:hover': {
                              bgcolor: isSelected ? '#0f3320' : buttonBg,
                              transform: 'scale(1.05)',
                              boxShadow: `0 4px 12px ${isSelected ? BRAND.primary : buttonColor}40`,
                              borderColor: isSelected ? BRAND.primary : buttonColor,
                            },
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 0.3
                          }}
                        >
                          <Typography variant="caption" sx={{ 
                            fontWeight: 800, 
                            fontSize: { xs: 8, sm: 10 },
                            lineHeight: 1,
                            color: 'inherit'
                          }}>
                            {month.month.slice(0, 3)}
                          </Typography>
                          {isCurrentMonth && (
                            <Typography variant="caption" sx={{ 
                              fontSize: { xs: 6, sm: 7 }, 
                              opacity: 0.8,
                              lineHeight: 1,
                              color: 'inherit'
                            }}>
                              NOW
                            </Typography>
                          )}
                        </Button>
                      );
                    })}
                  </Box>
                </Box>

                {/* Selected Month Details */}
                {selectedMonthData && (
                  <Box sx={{ 
                    p: { xs: 1.5, sm: 2.5 }, 
                    bgcolor: '#f9fffe', 
                    borderRadius: 2, 
                    border: `2px solid ${BRAND.primary}`,
                    boxShadow: '0 2px 8px rgba(26,71,49,0.1)'
                  }}>
                    {/* Month Header */}
                    <Box sx={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'space-between', 
                      mb: 2, 
                      pb: 1.5, 
                      borderBottom: '2px solid #e0e0e0',
                      flexWrap: { xs: 'wrap', sm: 'nowrap' },
                      gap: 1
                    }}>
                      <Typography variant="h6" sx={{ 
                        fontWeight: 800, 
                        color: BRAND.primary, 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: 1,
                        fontSize: { xs: '1rem', sm: '1.25rem' }
                      }}>
                        📊 {selectedMonthData.month} 2026
                      </Typography>
                      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                        {/* Verification Status Badge */}
                        <Chip
                          label={selectedMonthData.status}
                          size="small"
                          sx={{
                            bgcolor: STATUS_COLORS[selectedMonthData.status]?.bg || '#f5f5f5',
                            color: STATUS_COLORS[selectedMonthData.status]?.color || '#888',
                            fontWeight: 700,
                            fontSize: { xs: 9, sm: 11 },
                            border: `1.5px solid ${STATUS_COLORS[selectedMonthData.status]?.color || '#888'}`,
                          }}
                        />
                        {/* Priority Pass Badge */}
                        {selectedMonthData.hasData && (
                          <Chip
                            label={selectedMonthData.priorityPass === 'Active' ? '✅ Priority Pass' : '❌ No Pass'}
                            size="small"
                            sx={{
                              bgcolor: selectedMonthData.priorityPass === 'Active' ? '#e3f2fd' : '#fdecea',
                              color: selectedMonthData.priorityPass === 'Active' ? '#1565c0' : '#c62828',
                              fontWeight: 700,
                              fontSize: { xs: 9, sm: 11 },
                              border: `1.5px solid ${selectedMonthData.priorityPass === 'Active' ? '#1565c0' : '#c62828'}`,
                            }}
                          />
                        )}
                      </Box>
                    </Box>

                    {/* Details Grid */}
                    {selectedMonthData.hasData ? (
                      <Box sx={{ 
                        display: 'grid', 
                        gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, 
                        gap: 2,
                        overflow: 'hidden'
                      }}>
                        {/* Merchant Info */}
                        {selectedMonthData.merchantName && (
                          <Box>
                            <Typography variant="caption" sx={{ 
                              color: 'text.secondary', 
                              fontWeight: 600, 
                              display: 'block', 
                              mb: 0.5,
                              fontSize: { xs: '0.65rem', sm: '0.75rem' }
                            }}>
                              Merchant Name
                            </Typography>
                            <Typography variant="body2" sx={{ 
                              fontWeight: 700,
                              fontSize: { xs: '0.8rem', sm: '0.875rem' }
                            }}>
                              {selectedMonthData.merchantName}
                            </Typography>
                          </Box>
                        )}

                        {/* Location */}
                        {selectedMonthData.location && (
                          <Box>
                            <Typography variant="caption" sx={{ 
                              color: 'text.secondary', 
                              fontWeight: 600, 
                              display: 'block', 
                              mb: 0.5,
                              fontSize: { xs: '0.65rem', sm: '0.75rem' }
                            }}>
                              Location
                            </Typography>
                            <Typography variant="body2" sx={{ 
                              fontWeight: 700,
                              fontSize: { xs: '0.8rem', sm: '0.875rem' }
                            }}>
                              📍 {selectedMonthData.location}
                            </Typography>
                          </Box>
                        )}

                        {/* Priority Pass Status */}
                        <Box>
                          <Typography variant="caption" sx={{ 
                            color: 'text.secondary', 
                            fontWeight: 600, 
                            display: 'block', 
                            mb: 0.5,
                            fontSize: { xs: '0.65rem', sm: '0.75rem' }
                          }}>
                            Priority Pass Pro
                          </Typography>
                          <Typography variant="body2" sx={{ 
                            fontWeight: 700, 
                            color: selectedMonthData.priorityPass === 'Active' ? '#2e7d32' : '#c62828',
                            fontSize: { xs: '0.8rem', sm: '0.875rem' }
                          }}>
                            {selectedMonthData.priorityPass === 'Active' ? '✅ Active' : selectedMonthData.priorityPass || '❌ Not Active'}
                          </Typography>
                        </Box>

                        {/* Last Updated */}
                        {selectedMonthData.lastUpdated && (
                          <Box>
                            <Typography variant="caption" sx={{ 
                              color: 'text.secondary', 
                              fontWeight: 600, 
                              display: 'block', 
                              mb: 0.5,
                              fontSize: { xs: '0.65rem', sm: '0.75rem' }
                            }}>
                              Last Updated
                            </Typography>
                            <Typography variant="body2" sx={{ 
                              fontWeight: 700,
                              fontSize: { xs: '0.8rem', sm: '0.875rem' }
                            }}>
                              {new Date(selectedMonthData.lastUpdated).toLocaleDateString('en-IN', { 
                                day: 'numeric', 
                                month: 'short', 
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </Typography>
                          </Box>
                        )}

                        {/* Verification Checks */}
                        {selectedMonthData.verification?.checks && selectedMonthData.verification.checks.length > 0 && (
                          <Box sx={{ gridColumn: { xs: '1', sm: '1 / -1' } }}>
                            <Typography variant="caption" sx={{ 
                              color: 'text.secondary', 
                              fontWeight: 600, 
                              display: 'block', 
                              mb: 1,
                              fontSize: { xs: '0.65rem', sm: '0.75rem' }
                            }}>
                              Verification Checks
                            </Typography>
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.8 }}>
                              {selectedMonthData.verification.checks.map((check, idx) => (
                                <Box key={idx} sx={{ 
                                  display: 'flex', 
                                  alignItems: 'center', 
                                  gap: 1,
                                  p: { xs: 0.8, sm: 1 },
                                  bgcolor: check.pass ? '#e6f4ea' : '#fdecea',
                                  borderRadius: 1,
                                  border: `1px solid ${check.pass ? '#2e7d32' : '#c62828'}30`,
                                  overflow: 'hidden',
                                  position: 'relative'
                                }}>
                                  <Box sx={{ 
                                    width: { xs: 18, sm: 20 }, 
                                    height: { xs: 18, sm: 20 }, 
                                    borderRadius: '50%', 
                                    bgcolor: check.pass ? '#2e7d32' : '#c62828',
                                    color: '#fff',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontWeight: 700,
                                    fontSize: { xs: 10, sm: 12 },
                                    flexShrink: 0
                                  }}>
                                    {check.pass ? '✓' : '✗'}
                                  </Box>
                                  <Box sx={{ flex: 1 }}>
                                    <Typography variant="body2" sx={{ 
                                      fontWeight: 600, 
                                      fontSize: { xs: 11, sm: 12 }
                                    }}>
                                      {check.label}
                                    </Typography>
                                    {check.actual && (
                                      <Typography variant="caption" color="text.secondary" sx={{ 
                                        fontSize: { xs: 9, sm: 10 }
                                      }}>
                                        Value: {check.actual}
                                      </Typography>
                                    )}
                                  </Box>
                                </Box>
                              ))}
                            </Box>
                          </Box>
                        )}
                      </Box>
                    ) : (
                      <Alert severity="info" sx={{ mt: 1 }}>
                        No data found for {selectedMonthData.month} 2026. This merchant may not have been active in this month.
                      </Alert>
                    )}

                    {/* Data Source Info */}
                    {selectedMonthData.verification?.collection && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2, pt: 1.5, borderTop: '1px solid #e0e0e0' }}>
                        📂 Data source: {selectedMonthData.verification.collection} ({selectedMonthData.verification.matchType || 'exact'} match)
                      </Typography>
                    )}
                  </Box>
                )}
              </Box>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}

export default TideMerchantTimeline;
