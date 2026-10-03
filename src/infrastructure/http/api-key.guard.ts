import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  public canActivate(context: ExecutionContext): boolean {
    const expected = process.env.API_KEY;
    if (!expected) return true;

    const request = context.switchToHttp().getRequest<Request>();
    if (request.path === '/healthz' || request.path === '/readyz') return true;
    const provided = request.header('x-api-key');
    if (provided !== expected) throw new UnauthorizedException('INVALID_API_KEY');
    return true;
  }
}
