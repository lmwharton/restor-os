"use client";

import { useQuery } from "@tanstack/react-query";
import { mockJobs, mockRooms, mockReadings, mockPhotos, mockEvents } from "../mock-data";
import type { JobDetail, Room, MoistureReading, Photo, Event } from "../types";

// Toggle to false when backend endpoints are ready
const USE_MOCKS = true;

export function useJobs() {
  return useQuery<JobDetail[]>({
    queryKey: ["jobs"],
    queryFn: async () => {
      if (USE_MOCKS) return mockJobs;
      const res = await fetch("/api/v1/jobs");
      return res.json().then((d) => d.items);
    },
  });
}

export function useJob(jobId: string) {
  return useQuery<JobDetail | undefined>({
    queryKey: ["jobs", jobId],
    queryFn: async () => {
      if (USE_MOCKS) return mockJobs.find((j) => j.id === jobId);
      const res = await fetch(`/api/v1/jobs/${jobId}`);
      return res.json();
    },
    enabled: !!jobId,
  });
}

export function useRooms(jobId: string) {
  return useQuery<Room[]>({
    queryKey: ["rooms", jobId],
    queryFn: async () => {
      if (USE_MOCKS) return mockRooms.filter((r) => r.job_id === jobId);
      const res = await fetch(`/api/v1/jobs/${jobId}/rooms`);
      return res.json().then((d) => d.items);
    },
    enabled: !!jobId,
  });
}

export function useReadings(jobId: string, roomId: string) {
  return useQuery<MoistureReading[]>({
    queryKey: ["readings", jobId, roomId],
    queryFn: async () => {
      if (USE_MOCKS) return mockReadings.filter((r) => r.room_id === roomId);
      const res = await fetch(`/api/v1/jobs/${jobId}/rooms/${roomId}/readings`);
      return res.json().then((d) => d.items);
    },
    enabled: !!jobId && !!roomId,
  });
}

export function usePhotos(jobId: string) {
  return useQuery<Photo[]>({
    queryKey: ["photos", jobId],
    queryFn: async () => {
      if (USE_MOCKS) return mockPhotos.filter((p) => p.job_id === jobId);
      const res = await fetch(`/api/v1/jobs/${jobId}/photos`);
      return res.json().then((d) => d.items);
    },
    enabled: !!jobId,
  });
}

export function useJobEvents(jobId: string) {
  return useQuery<Event[]>({
    queryKey: ["events", jobId],
    queryFn: async () => {
      if (USE_MOCKS) return mockEvents.filter((e) => e.job_id === jobId);
      const res = await fetch(`/api/v1/jobs/${jobId}/events`);
      return res.json().then((d) => d.items);
    },
    enabled: !!jobId,
  });
}
