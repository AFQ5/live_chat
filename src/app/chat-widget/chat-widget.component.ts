// chat-widget.component.ts
import { Component, OnInit, OnDestroy, ViewChild, ElementRef, inject } from '@angular/core';
import { trigger, style, transition, animate } from '@angular/animations';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil, finalize } from 'rxjs';
import { ChatService, ChatMessage, ChatResponse, EscalationData } from './chat.service';

@Component({
  selector: 'app-chat-widget',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './chat-widget.component.html',
  styleUrls: ['./chat-widget.component.scss'],
  animations: [
    trigger('fadeIn', [
      transition(':enter', [
        style({ opacity: 0 }),
        animate('300ms', style({ opacity: 1 }))
      ])
    ]),
    trigger('slideUp', [
      transition(':enter', [
        style({ transform: 'translateY(100%)', opacity: 0 }),
        animate('300ms ease-out', style({ transform: 'translateY(0)', opacity: 1 }))
      ]),
      transition(':leave', [
        animate('300ms ease-in', style({ transform: 'translateY(100%)', opacity: 0 }))
      ])
    ])
  ]
})
export class ChatWidgetComponent implements OnInit, OnDestroy {
  @ViewChild('chatMessages', { static: false }) chatMessagesRef!: ElementRef<HTMLDivElement>;

  // State from service
  messages: ChatMessage[] = [];
  showTypingIndicator = false;
  
  // Local state
  isOpen = false;
  isProcessing = false;
  isFirstMessage = true;
  isWaitingForAgent = false;
  agentConnectionInfo: any = null;
  isAgentConnected = false;
  userInput = '';
  
  private lastMessageTime = 0;
  private readonly destroy$ = new Subject<void>();
  private readonly chatService = inject(ChatService);

  ngOnInit(): void {
    // Subscribe to messages
    this.chatService.messages$
      .pipe(takeUntil(this.destroy$))
      .subscribe((messages: ChatMessage[]) => {
        this.messages = messages;
        this.scrollToBottom();
      });
    
    // Subscribe to typing indicator
    this.chatService.typing$
      .pipe(takeUntil(this.destroy$))
      .subscribe((isTyping: boolean) => {
        this.showTypingIndicator = isTyping;
        if (isTyping) {
          this.scrollToBottom();
        }
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  toggleChat(): void {
    this.isOpen = !this.isOpen;
    
    if (this.isOpen && this.isFirstMessage) {
      this.isFirstMessage = false;
      setTimeout(() => {
        if (!this.isProcessing) {
          this.sendMessage("");
        }
      }, 500);
    }
  }

  sendMessage(message: string): void {
    if (this.isProcessing) {
      return;
    }

    const currentTime = Date.now();
    if (currentTime - this.lastMessageTime < 1000) {
      return;
    }
    this.lastMessageTime = currentTime;

    this.isProcessing = true;

    if (message) {
      this.chatService.addMessage({
        type: 'user',
        content: message,
        timestamp: new Date()
      });
    }

    this.chatService.setTyping(true);

    this.chatService.sendMessage(message)
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => {
          this.chatService.setTyping(false);
          this.isProcessing = false;
        })
      )
      .subscribe({
        next: (response: ChatResponse | ChatResponse[]) => {
          const chatResponse = Array.isArray(response) ? response[0] : response;

          if (!chatResponse) {
            return;
          }

          // Handle AI agent responses
          if (chatResponse.isAgentResponse) {
            this.chatService.addMessage({
              type: 'bot',
              content: chatResponse.message,
              options: chatResponse.options || [],
              timestamp: new Date()
            });

            if (chatResponse.allowTyping) {
              this.isAgentConnected = true;
            }

            if (chatResponse.endSession) {
              setTimeout(() => {
                this.isOpen = false;
                this.chatService.clearMessages();
                this.isFirstMessage = true;
                this.isWaitingForAgent = false;
                this.agentConnectionInfo = null;
                this.isAgentConnected = false;
              }, 3000);
            }
          } 
          // Handle regular bot responses
          else if (chatResponse.message) {
            this.isFirstMessage = false;

            this.chatService.addMessage({
              type: 'bot',
              content: chatResponse.message,
              options: chatResponse.options || [],
              timestamp: new Date()
            });

            if (chatResponse.callAgent) {
              this.isWaitingForAgent = true;
              this.agentConnectionInfo = {
                reason: chatResponse.escalationReason,
                path: chatResponse.customerPath,
                attempt: chatResponse.escalationAttempt
              };
              setTimeout(() => this.connectToAgent(), 3000);
            } else if (chatResponse.cancelAgent) {
              this.isWaitingForAgent = false;
              this.agentConnectionInfo = null;
              this.isAgentConnected = false;
            }

            if (chatResponse.endSession) {
              setTimeout(() => {
                this.isOpen = false;
                this.chatService.clearMessages();
                this.isFirstMessage = true;
                this.isWaitingForAgent = false;
                this.agentConnectionInfo = null;
                this.isAgentConnected = false;
              }, 3000);
            }
            
            if (chatResponse.newSession) {
              this.chatService.clearMessages();
              this.chatService.addMessage({
                type: 'bot',
                content: chatResponse.message,
                options: chatResponse.options || [],
                timestamp: new Date()
              });
              if (chatResponse.sessionId && this.chatService.getSessionId() !== chatResponse.sessionId) {
                this.chatService.setSessionId(chatResponse.sessionId);
              }
              this.isWaitingForAgent = false;
              this.agentConnectionInfo = null;
              this.isAgentConnected = false;
            }
          }
        },
        error: (error: any) => {
          this.chatService.addMessage({
            type: 'bot',
            content: 'عذراً، حدث خطأ. يرجى المحاولة مرة أخرى لاحقاً.',
            options: ['المحاولة مرة أخرى'],
            timestamp: new Date()
          });
        }
      });
  }

  handleOptionClick(option: string): void {
    if (this.isProcessing) {
      return;
    }
    this.chatService.removeLastMessageOptions();
    if (option === 'المحاولة مرة أخرى') {
      this.sendMessage('');
    } else {
      this.sendMessage(option);
    }
  }

  handleUserSubmit(): void {
    if (this.userInput.trim()) {
      this.sendMessage(this.userInput.trim());
      this.userInput = '';
    }
  }

    private connectToAgent(): void {
    if (this.isWaitingForAgent && this.agentConnectionInfo) {
      this.isWaitingForAgent = false;

      const escalationData: EscalationData = {
        sessionId: this.chatService.getSessionId(),
        escalated: true,
        escalationReason: this.agentConnectionInfo.reason,
        customerPath: this.agentConnectionInfo.path,
        escalationAttempt: this.agentConnectionInfo.attempt ?? 1,
        conversationHistory: this.messages.map(msg => ({
          user: msg.type === 'user' ? msg.content : '',
          bot: msg.type === 'bot' ? msg.content : '',
          timestamp: msg.timestamp
        }))
      };

      this.chatService.setTyping(true);

      this.chatService.escalateToAgent(escalationData).pipe(
        takeUntil(this.destroy$),
        finalize(() => {
          this.chatService.setTyping(false);
        })
      ).subscribe({
        next: (agentResponse: ChatResponse) => {
          this.isAgentConnected = true;

          this.chatService.addMessage({
            type: 'bot',
            content: agentResponse.message,
            options: agentResponse.options,
            timestamp: new Date()
          });

          if (agentResponse.sessionId) {
            this.chatService.setSessionId(agentResponse.sessionId);
          }
        },
        error: (error: any) => {
          console.error('Failed to connect to agent:', error);
          this.chatService.addMessage({
            type: 'bot',
            content: 'عذراً، حدث خطأ في الاتصال بممثل الخدمة. يرجى المحاولة مرة أخرى.',
            options: ['المحاولة مرة أخرى'],
            timestamp: new Date()
          });
          this.isWaitingForAgent = false;
        }
      });
    }
  }

  private scrollToBottom(): void {
    setTimeout(() => {
      if (this.chatMessagesRef?.nativeElement) {
        const element = this.chatMessagesRef.nativeElement;
        element.scrollTop = element.scrollHeight;
      }
    }, 0);
  }

  trackByMessageId(index: number, message: ChatMessage): string {
    return message.id ?? `${message.type}-${index}`;
  }
}