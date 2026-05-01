import React from 'react';
import { Alert, Button, Box } from '@mui/material';

export default function ImpersonationBanner({ isImpersonating, targetName, targetEmail, onExit }) {
  if (!isImpersonating) return null;

  return (
    <Alert 
      severity="info" 
      sx={{ mb: 2, fontWeight: 600 }}
      action={
        <Button 
          color="inherit" 
          size="small" 
          onClick={onExit}
          sx={{ fontWeight: 700 }}
        >
          Exit View
        </Button>
      }
    >
      👁️ Viewing as <strong>{targetName}</strong> ({targetEmail}) - Admin Mode
    </Alert>
  );
}
