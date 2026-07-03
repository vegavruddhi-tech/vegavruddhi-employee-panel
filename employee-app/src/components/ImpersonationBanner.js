import React from 'react';
import { Alert, Button, Box } from '@mui/material';

export default function ImpersonationBanner({ isImpersonating, targetName, targetEmail, onExit }) {
  if (!isImpersonating) return null;

  return (
    <Alert 
      severity="info" 
      sx={{ mb: 2, fontWeight: 600, bgcolor: '#e3f2fd', border: '1px solid #90caf9', color: '#0d47a1', display: 'flex', alignItems: 'center' }}
      action={
        <Button 
          variant="contained"
          color="primary" 
          size="small" 
          onClick={onExit}
          sx={{ fontWeight: 700, bgcolor: '#1976d2', color: '#fff', '&:hover': { bgcolor: '#115293' }, textTransform: 'none' }}
        >
          ⬅ Return to Admin Approvals
        </Button>
      }
    >
      👁️ Viewing FSE Dashboard as <strong>{targetName}</strong> ({targetEmail}) — Admin Mode
    </Alert>
  );
}
