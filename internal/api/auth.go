package api

import (
	"crypto/rand"
	"encoding/hex"
	"sync"
	"time"
)

// TicketInfo stores information about a temporary auth ticket
type TicketInfo struct {
	CreatedAt time.Time
}

// TicketStore manages short-lived authentication tickets
type TicketStore struct {
	tickets sync.Map
	ttl     time.Duration
}

// NewTicketStore creates a new TicketStore with specified TTL
func NewTicketStore(ttl time.Duration) *TicketStore {
	store := &TicketStore{
		ttl: ttl,
	}
	// Start a periodic cleanup routine
	go store.cleanupRoutine()
	return store
}

// Generate creates a new random ticket and stores it
func (s *TicketStore) Generate() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	ticket := hex.EncodeToString(b)
	
	s.tickets.Store(ticket, TicketInfo{
		CreatedAt: time.Now(),
	})
	return ticket
}

// Consume validates and removes a ticket
func (s *TicketStore) Consume(ticket string) bool {
	if ticket == "" {
		return false
	}
	
	val, ok := s.tickets.Load(ticket)
	if !ok {
		return false
	}
	
	info := val.(TicketInfo)
	s.tickets.Delete(ticket) // Use-once
	
	// Check if expired
	if time.Since(info.CreatedAt) > s.ttl {
		return false
	}
	
	return true
}

func (s *TicketStore) cleanupRoutine() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	
	for range ticker.C {
		now := time.Now()
		s.tickets.Range(func(key, value interface{}) bool {
			info := value.(TicketInfo)
			if now.Sub(info.CreatedAt) > s.ttl {
				s.tickets.Delete(key)
			}
			return true
		})
	}
}
