import { Box, Button, Typography } from '@mui/material';
import {
  NavigateNext as NavigateNextIcon,
  NavigateBefore as NavigateBeforeIcon,
  FirstPage as FirstPageIcon,
  LastPage as LastPageIcon
} from '@mui/icons-material';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  itemsPerPage: number;
  onPageChange: (page: number) => void;
}

export default function Pagination({
  currentPage,
  totalPages,
  totalItems,
  itemsPerPage,
  onPageChange
}: PaginationProps) {
  if (totalPages <= 1) return null;

  const startItem = (currentPage - 1) * itemsPerPage + 1;
  const endItem = Math.min(currentPage * itemsPerPage, totalItems);

  // Generate page numbers to display
  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    const maxVisiblePages = 7;

    if (totalPages <= maxVisiblePages) {
      // Show all pages if total is small
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      // Show first page
      pages.push(1);

      if (currentPage > 3) {
        pages.push('...');
      }

      // Show pages around current page
      const startPage = Math.max(2, currentPage - 1);
      const endPage = Math.min(totalPages - 1, currentPage + 1);

      for (let i = startPage; i <= endPage; i++) {
        pages.push(i);
      }

      if (currentPage < totalPages - 2) {
        pages.push('...');
      }

      // Show last page
      pages.push(totalPages);
    }

    return pages;
  };

  const pageNumbers = getPageNumbers();

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        mt: 3,
        mb: 2,
        flexWrap: 'wrap',
        gap: 2
      }}
    >
      {/* Items info */}
      <Typography variant="body2" color="text.secondary">
        Showing {startItem} to {endItem} of {totalItems} items
      </Typography>

      {/* Pagination controls */}
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
        {/* First page button */}
        <Button
          size="small"
          variant="outlined"
          onClick={() => onPageChange(1)}
          disabled={currentPage === 1}
          sx={{
            minWidth: '40px',
            height: '40px',
            borderColor: '#2563EB',
            color: '#2563EB',
            '&:hover': {
              borderColor: '#1D4ED8',
              backgroundColor: '#EFF6FF'
            },
            '&.Mui-disabled': {
              borderColor: '#E5E7EB',
              color: '#9CA3AF'
            }
          }}
        >
          <FirstPageIcon fontSize="small" />
        </Button>

        {/* Previous button */}
        <Button
          size="small"
          variant="outlined"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          sx={{
            minWidth: '40px',
            height: '40px',
            borderColor: '#2563EB',
            color: '#2563EB',
            '&:hover': {
              borderColor: '#1D4ED8',
              backgroundColor: '#EFF6FF'
            },
            '&.Mui-disabled': {
              borderColor: '#E5E7EB',
              color: '#9CA3AF'
            }
          }}
        >
          <NavigateBeforeIcon fontSize="small" />
        </Button>

        {/* Page numbers */}
        {pageNumbers.map((page, index) => {
          if (page === '...') {
            return (
              <Typography
                key={`ellipsis-${index}`}
                sx={{ px: 1, color: 'text.secondary' }}
              >
                ...
              </Typography>
            );
          }

          const pageNumber = page as number;
          const isActive = pageNumber === currentPage;

          return (
            <Button
              key={pageNumber}
              size="small"
              variant={isActive ? 'contained' : 'outlined'}
              onClick={() => onPageChange(pageNumber)}
              sx={{
                minWidth: '40px',
                height: '40px',
                borderColor: isActive ? '#2563EB' : '#E5E7EB',
                backgroundColor: isActive ? '#2563EB' : 'transparent',
                color: isActive ? '#FFFFFF' : '#2563EB',
                fontWeight: isActive ? 600 : 400,
                '&:hover': {
                  borderColor: '#1D4ED8',
                  backgroundColor: isActive ? '#1D4ED8' : '#EFF6FF'
                }
              }}
            >
              {pageNumber}
            </Button>
          );
        })}

        {/* Next button */}
        <Button
          size="small"
          variant="outlined"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          sx={{
            minWidth: '40px',
            height: '40px',
            borderColor: '#2563EB',
            color: '#2563EB',
            '&:hover': {
              borderColor: '#1D4ED8',
              backgroundColor: '#EFF6FF'
            },
            '&.Mui-disabled': {
              borderColor: '#E5E7EB',
              color: '#9CA3AF'
            }
          }}
        >
          <NavigateNextIcon fontSize="small" />
        </Button>

        {/* Last page button */}
        <Button
          size="small"
          variant="outlined"
          onClick={() => onPageChange(totalPages)}
          disabled={currentPage === totalPages}
          sx={{
            minWidth: '40px',
            height: '40px',
            borderColor: '#2563EB',
            color: '#2563EB',
            '&:hover': {
              borderColor: '#1D4ED8',
              backgroundColor: '#EFF6FF'
            },
            '&.Mui-disabled': {
              borderColor: '#E5E7EB',
              color: '#9CA3AF'
            }
          }}
        >
          <LastPageIcon fontSize="small" />
        </Button>
      </Box>
    </Box>
  );
}
