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
	Principal *Principal
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
func clonePrincipal(p *Principal) *Principal {
	if p == nil {
		return nil
	}
	cp := &Principal{
		IsSuperAdmin: p.IsSuperAdmin,
		User:         p.User,
	}
	if p.Permissions != nil {
		cp.Permissions = append([]string(nil), p.Permissions...)
	}
	return cp
}

func (s *TicketStore) Generate(principal *Principal) string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	ticket := hex.EncodeToString(b)

	s.tickets.Store(ticket, TicketInfo{
		CreatedAt: time.Now(),
		Principal: clonePrincipal(principal),
	})
	return ticket
}

// Consume validates and removes a ticket
func (s *TicketStore) Consume(ticket string) (*Principal, bool) {
	if ticket == "" {
		return nil, false
	}

	val, ok := s.tickets.Load(ticket)
	if !ok {
		return nil, false
	}

	info := val.(TicketInfo)
	s.tickets.Delete(ticket) // Use-once

	// Check if expired
	if time.Since(info.CreatedAt) > s.ttl {
		return nil, false
	}

	return clonePrincipal(info.Principal), info.Principal != nil
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
