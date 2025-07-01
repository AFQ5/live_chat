// chat.service.ts (Optional - for better separation of concerns)
import { Injectable } from '@angular/core';
import { Observable, BehaviorSubject, from, throwError } from 'rxjs';
import { catchError, timeout, tap } from 'rxjs/operators';

export interface ChatMessage {
  type: 'user' | 'bot';
  content: string;
  options?: string[];
  timestamp: Date;
  id?: string;
}

export interface ChatConfig {
  webhookUrl: string;
  sessionId: string;
  timeout?: number;
}

export interface EscalationData {
  sessionId: string;
  escalated: boolean;
  escalationReason: string;
  customerPath: string[];
  escalationAttempt: number;
  conversationHistory: {
    user: string;
    bot: string;
    timestamp: Date;
  }[];
}

export interface ChatResponse {
  sessionId?: string;
  message: string;
  options: string[];
  endSession?: boolean;
  newSession?: boolean;
  callAgent?: boolean;
  cancelAgent?: boolean;
  escalationReason?: string;
  customerPath?: string[];
  escalationAttempt?: number;
  isAgentResponse?: boolean;
  allowTyping?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class ChatService {
  private readonly messagesSubject = new BehaviorSubject<ChatMessage[]>([]);
  private readonly typingSubject = new BehaviorSubject<boolean>(false);
  
  messages$ = this.messagesSubject.asObservable();
  typing$ = this.typingSubject.asObservable();
  
  private _config: ChatConfig = {
    webhookUrl: "http://localhost:5678/webhook/chat",
    sessionId: `session-${Date.now()}`,
    timeout: 30000
  };

  constructor() {}

  // Send message to API
  sendMessage(message: string): Observable<ChatResponse | ChatResponse[]> {
    const body: { sessionId: string; message?: string } = {
      sessionId: this._config.sessionId,
    };

    if (message) {
      body.message = message;
    }

    return from(
      fetch(this._config.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }).then(async (response) => {
        const responseText = await response.text();
        console.log('Raw response from webhook:', responseText);

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}, body: ${responseText}`);
        }
        return JSON.parse(responseText);
      })
    ).pipe(
      timeout(30000),
      tap(response => {
        const res = Array.isArray(response) ? response[0] : response;
        if (res?.sessionId) {
          this._config.sessionId = res.sessionId;
        }
      }),
      catchError(error => {
        console.error('Chat API error:', error);
        return throwError(() => error);
      })
    );
  }

  // Add message to chat
  addMessage(message: ChatMessage): void {
    const messages = this.messagesSubject.value;
    const newMessage = {
      ...message,
      id: `${message.type}-${Date.now()}`,
      timestamp: message.timestamp || new Date()
    };
    this.messagesSubject.next([...messages, newMessage]);
  }

  // Remove options from last bot message
  removeLastMessageOptions(): void {
    const messages = this.messagesSubject.value;
    const lastMessage = messages[messages.length - 1];
    
    if (lastMessage && lastMessage.type === 'bot') {
      lastMessage.options = [];
      this.messagesSubject.next([...messages]);
    }
  }

  // Set typing indicator
  setTyping(isTyping: boolean): void {
    this.typingSubject.next(isTyping);
  }

  // Clear all messages
  clearMessages(): void {
    this.messagesSubject.next([]);
  }

  // Update configuration
  updateConfig(config: Partial<ChatConfig>): void {
    this._config = { ...this._config, ...config };
  }

  get config(): ChatConfig {
    return this._config;
  }

  // Get current session ID
  getSessionId(): string {
    return this._config.sessionId;
  }

  // Set new session ID
  setSessionId(sessionId: string): void {
    this._config.sessionId = sessionId;
  }

  escalateToAgent(escalationData: EscalationData): Observable<ChatResponse> {
    return from(
      fetch(this._config.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(escalationData),
      }).then(async (response) => {
        const responseText = await response.text();
        console.log('Raw response from webhook (escalation):', responseText);

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}, body: ${responseText}`);
        }
        
        return JSON.parse(responseText);
      })
    ).pipe(
      timeout(this._config.timeout ?? 30000),
      tap((response: ChatResponse) => {
        if (response?.sessionId) {
          this._config.sessionId = response.sessionId;
        }
      }),
      catchError(error => {
        console.error('Agent escalation API error:', error);
        return throwError(() => error);
      })
    );
  }
}