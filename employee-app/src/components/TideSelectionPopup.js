import React from 'react';
import { Dialog, DialogTitle, DialogContent, Button, Box, Typography } from '@mui/material';

const TideSelectionPopup = ({ open, onClose, onSelectTide, onSelectTideBT }) => {
  return (
    <Dialog 
      open={open} 
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        style: {
          borderRadius: 16,
          padding: '20px'
        }
      }}
    >
      <DialogTitle sx={{ textAlign: 'center', pb: 1 }}>
        <Typography variant="h5" fontWeight="bold" color="primary">
          Select Dashboard
        </Typography>
      </DialogTitle>
      
      <DialogContent>
        <Typography variant="body2" color="text.secondary" textAlign="center" mb={3}>
          You have access to both Tide and Tide BT. Please select which dashboard you want to access.
        </Typography>
        
        <Box display="flex" flexDirection="column" gap={2}>
          <Button
            variant="contained"
            size="large"
            onClick={onSelectTide}
            sx={{
              py: 2,
              fontSize: '1.1rem',
              fontWeight: 'bold',
              background: 'linear-gradient(45deg, #2196F3 30%, #21CBF3 90%)',
              '&:hover': {
                background: 'linear-gradient(45deg, #1976D2 30%, #00B0D7 90%)',
              }
            }}
          >
            Tide Dashboard
          </Button>
          
          <Button
            variant="contained"
            size="large"
            onClick={onSelectTideBT}
            sx={{
              py: 2,
              fontSize: '1.1rem',
              fontWeight: 'bold',
              background: 'linear-gradient(45deg, #FF6B6B 30%, #FF8E53 90%)',
              '&:hover': {
                background: 'linear-gradient(45deg, #EE5A52 30%, #FF7043 90%)',
              }
            }}
          >
            Tide BT Dashboard
          </Button>
        </Box>
      </DialogContent>
    </Dialog>
  );
};

export default TideSelectionPopup;
